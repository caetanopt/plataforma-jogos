"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { runSerializable } from "@/lib/db/transaction-retry";
import {
  WHEEL_EDITOR_MESSAGES,
  resolvePeriod,
  segmentTotalBelowUsedMessage,
  wheelSegmentShape,
} from "@/lib/validation/wheel-game";
import { emptyToNull, getField, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const wheelSegmentSchema = z.object(wheelSegmentShape);

const INVALID_SEGMENT_MESSAGE = "O segmento não foi guardado: corrija os campos assinalados.";
const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";
const SEGMENT_GONE_MESSAGE = "O segmento já não existe. Recarregue a página.";

async function getOwnedWheelConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "WHEEL" },
    include: { wheelConfig: true },
  });
  return campaign?.wheelConfig ? { campaign, wheelConfig: campaign.wheelConfig } : null;
}

/**
 * Um segmento só pode apontar para um prémio da própria campanha.
 *
 * O `prizeId` chega do formulário, e o sorteio consome o stock e os códigos
 * do prémio ligado. Sem esta verificação, um editor podia ligar os seus
 * segmentos ao prémio de outra organização e esgotar-lhe os vouchers.
 */
async function resolveSegmentPrizeId(
  campaignId: string,
  data: { outcome: "WIN" | "NO_WIN"; prizeId?: string },
): Promise<string | null> {
  if (data.outcome !== "WIN" || !data.prizeId) return null;

  const prize = await prisma.prize.findFirst({
    where: { id: data.prizeId, campaignId },
    select: { id: true },
  });
  if (!prize) notFound();
  return prize.id;
}

function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export async function addWheelSegmentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addWheelSegment", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const parsed = wheelSegmentSchema.safeParse({
      name: getField(formData, "name"),
      colorHex: getField(formData, "colorHex"),
      imageMediaId: getField(formData, "imageMediaId"),
      outcome: getField(formData, "outcome"),
      prizeId: getField(formData, "prizeId"),
      weight: getField(formData, "weight"),
      totalQuantity: getField(formData, "totalQuantity"),
      periodStart: getField(formData, "periodStart"),
      periodEnd: getField(formData, "periodEnd"),
      message: getField(formData, "message"),
      code: getField(formData, "code"),
      // Sem a checkbox no pedido, fica ativo, como o valor por omissão da BD.
      isActive: readCheckbox(formData, "isActive") ?? true,
    });
    if (!parsed.success) return fail(INVALID_SEGMENT_MESSAGE, zodFieldErrors(parsed.error));
    const data = parsed.data;

    const period = resolvePeriod(
      { start: data.periodStart, end: data.periodEnd },
      { start: null, end: null },
      owned.campaign.timezone,
    );
    if (!period.ordered) return fail(INVALID_SEGMENT_MESSAGE, { periodEnd: WHEEL_EDITOR_MESSAGES.periodOrder });

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const prizeId = await resolveSegmentPrizeId(owned.campaign.id, data);

    const existing = await prisma.wheelSegment.findMany({
      where: { wheelConfigId: owned.wheelConfig.id },
      select: { order: true },
    });
    const nextOrder = existing.reduce((max, s) => Math.max(max, s.order), -1) + 1;

    const segment = await prisma.wheelSegment.create({
      data: {
        wheelConfigId: owned.wheelConfig.id,
        order: nextOrder,
        name: data.name,
        colorHex: data.colorHex,
        imageMediaId: data.imageMediaId || null,
        outcome: data.outcome,
        prizeId,
        weight: data.weight,
        totalQuantity: data.totalQuantity,
        remainingQuantity: data.totalQuantity,
        periodStart: period.start ?? null,
        periodEnd: period.end ?? null,
        message: data.message || null,
        code: data.code || null,
        isActive: data.isActive,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "WheelSegment",
      entityId: segment.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Segmento adicionado.");
  });
}

export async function updateWheelSegmentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateWheelSegment", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const segmentId = readOptional(formData, "segmentId") ?? "";
    const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const segment = await prisma.wheelSegment.findFirst({
      where: { id: segmentId, wheelConfigId: owned.wheelConfig.id },
    });
    if (!segment) notFound();

    // Só os campos que o formulário enviou: os outros ficam como estão. Antes
    // um formulário sem imagem, mensagem, código ou período apagava-os.
    const parse = parsePartial(wheelSegmentShape, {
      name: readOptional(formData, "name"),
      colorHex: readOptional(formData, "colorHex"),
      imageMediaId: readOptional(formData, "imageMediaId"),
      outcome: readOptional(formData, "outcome"),
      prizeId: readOptional(formData, "prizeId"),
      weight: readOptional(formData, "weight"),
      totalQuantity: readOptional(formData, "totalQuantity"),
      periodStart: readOptional(formData, "periodStart"),
      periodEnd: readOptional(formData, "periodEnd"),
      message: readOptional(formData, "message"),
      code: readOptional(formData, "code"),
      isActive: readCheckbox(formData, "isActive"),
    });
    const { data } = parse;

    const period = resolvePeriod(
      { start: data.periodStart, end: data.periodEnd },
      { start: segment.periodStart, end: segment.periodEnd },
      owned.campaign.timezone,
    );
    if (!period.ordered) rejectField(parse, "periodEnd", WHEEL_EDITOR_MESSAGES.periodOrder);

    // Tudo ou nada: o peso, o stock e o prémio de um segmento decidem o
    // sorteio, e uma edição gravada a meias mudava as probabilidades sem que
    // o editor as tivesse confirmado.
    if (Object.keys(parse.fieldErrors).length > 0) return fail(INVALID_SEGMENT_MESSAGE, parse.fieldErrors);

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    // Um segmento que não ganha nunca guarda prémio. Um que ganha só muda de
    // prémio se o formulário enviou o campo, e só para um desta campanha.
    const outcome = data.outcome ?? segment.outcome;
    let prizeId: string | null | undefined;
    if (outcome === "NO_WIN") {
      if (data.outcome !== undefined || data.prizeId !== undefined) prizeId = null;
    } else if (data.prizeId !== undefined) {
      prizeId = await resolveSegmentPrizeId(owned.campaign.id, { outcome, prizeId: data.prizeId });
    }

    const fields = {
      name: data.name,
      colorHex: data.colorHex,
      imageMediaId: emptyToNull(data.imageMediaId),
      outcome: data.outcome,
      prizeId,
      weight: data.weight,
      periodStart: period.start,
      periodEnd: period.end,
      message: emptyToNull(data.message),
      code: emptyToNull(data.code),
      isActive: data.isActive,
    };
    const hasFields = Object.values(fields).some((value) => value !== undefined);
    if (!hasFields && data.totalQuantity === undefined) return ok();

    // Ler o stock e gravá-lo na mesma transação: uma rotação entre as duas
    // coisas descontava uma unidade que a gravação voltava a pôr.
    const saved = await runSerializable(async (tx) => {
      const before = await tx.wheelSegment.findUnique({ where: { id: segment.id } });
      if (!before) return { status: "gone" as const };

      let remainingQuantity: number | null | undefined;
      if (data.totalQuantity !== undefined) {
        // Unidades que já saíram deste segmento, atribuídas ou reservadas.
        // Com limite, é o total menos o restante; sem limite até agora,
        // contam-se os prémios do segmento ainda presos. Um total abaixo disso
        // é recusado (como no prémio): antes ficava a 0 e, quando as reservas
        // voltavam ao stock, o segmento dava mais do que o limite.
        const used =
          before.totalQuantity != null
            ? before.totalQuantity - (before.remainingQuantity ?? 0)
            : await tx.prizeAward.count({
                where: { wheelSegmentId: before.id, status: { in: ["CONFIRMED", "RESERVED"] } },
              });
        if (data.totalQuantity != null && data.totalQuantity < used) return { status: "below_used" as const, used };
        remainingQuantity = data.totalQuantity != null ? data.totalQuantity - used : null;
      }

      const after = await tx.wheelSegment.update({
        where: { id: before.id },
        data: { ...fields, totalQuantity: data.totalQuantity, remainingQuantity },
      });
      return { status: "saved" as const, before, after };
    });
    if (saved.status === "gone") return fail(SEGMENT_GONE_MESSAGE);
    if (saved.status === "below_used") {
      return fail(INVALID_SEGMENT_MESSAGE, { totalQuantity: segmentTotalBelowUsedMessage(saved.used) });
    }
    const { before, after } = saved;

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "WheelSegment",
      entityId: segment.id,
      result: "SUCCESS",
    });

    // Peso, estado, período e resultado mudam quem pode sair na roda (§26).
    // Só se compara o que o formulário enviou; o resto fica igual.
    const oddsChanged =
      before.weight !== after.weight ||
      before.isActive !== after.isActive ||
      before.outcome !== after.outcome ||
      before.periodStart?.getTime() !== after.periodStart?.getTime() ||
      before.periodEnd?.getTime() !== after.periodEnd?.getTime();
    if (oddsChanged) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "ODDS_CHANGE",
        entityType: "WheelSegment",
        entityId: segment.id,
        result: "SUCCESS",
        metadata: {
          weightBefore: before.weight,
          weightAfter: after.weight,
          isActiveBefore: before.isActive,
          isActiveAfter: after.isActive,
          outcomeBefore: before.outcome,
          outcomeAfter: after.outcome,
          periodStartBefore: isoOrNull(before.periodStart),
          periodStartAfter: isoOrNull(after.periodStart),
          periodEndBefore: isoOrNull(before.periodEnd),
          periodEndAfter: isoOrNull(after.periodEnd),
        },
      });
    }

    if (data.totalQuantity !== undefined && before.totalQuantity !== after.totalQuantity) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "STOCK_CHANGE",
        entityType: "WheelSegment",
        entityId: segment.id,
        result: "SUCCESS",
        metadata: {
          totalQuantityBefore: before.totalQuantity,
          totalQuantityAfter: after.totalQuantity,
          remainingQuantityBefore: before.remainingQuantity,
          remainingQuantityAfter: after.remainingQuantity,
        },
      });
    }

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Segmento guardado.");
  });
}

export async function removeWheelSegmentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeWheelSegment", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const segmentId = getField(formData, "segmentId");
    const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const deleted = await prisma.wheelSegment.deleteMany({
      where: { id: segmentId, wheelConfigId: owned.wheelConfig.id },
    });
    if (deleted.count === 0) return fail(SEGMENT_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "WheelSegment",
      entityId: segmentId,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function moveWheelSegmentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("moveWheelSegment", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const segmentId = getField(formData, "segmentId");
    const direction = getField(formData, "direction");
    const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    if (direction !== "up" && direction !== "down") return fail("Direção inválida. Recarregue a página.");

    const segments = await prisma.wheelSegment.findMany({
      where: { wheelConfigId: owned.wheelConfig.id },
      orderBy: { order: "asc" },
    });
    const index = segments.findIndex((s) => s.id === segmentId);
    if (index === -1) return fail(SEGMENT_GONE_MESSAGE);

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0) return fail("O segmento já é o primeiro da roda.");
    if (swapIndex >= segments.length) return fail("O segmento já é o último da roda.");

    const current = segments[index];
    const swapWith = segments[swapIndex];

    await prisma.$transaction([
      prisma.wheelSegment.update({ where: { id: current.id }, data: { order: swapWith.order } }),
      prisma.wheelSegment.update({ where: { id: swapWith.id }, data: { order: current.order } }),
    ]);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "WheelSegment",
      entityId: current.id,
      result: "SUCCESS",
      metadata: { action: "reorder", swappedWith: swapWith.id },
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}
