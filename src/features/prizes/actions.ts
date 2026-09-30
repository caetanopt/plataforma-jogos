"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { activeReservationsByPrize } from "@/features/prizes/stock";
import { releaseReservation } from "@/features/prizes/reservation";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { runSerializable } from "@/lib/db/transaction-retry";
import {
  WHEEL_EDITOR_MESSAGES,
  prizeCodeShape,
  prizeShape,
  prizeTotalBelowAwardedMessage,
  resolvePeriod,
} from "@/lib/validation/wheel-game";
import { zonedDateTimeToUtc } from "@/lib/dates/timezone";
import { emptyToNull, getField, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const prizeSchema = z.object(prizeShape);
const prizeCodeSchema = z.object(prizeCodeShape);

const INVALID_PRIZE_MESSAGE = "O prémio não foi guardado: corrija os campos assinalados.";
const INVALID_CODE_MESSAGE = "O código não foi adicionado.";
const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";
const PRIZE_GONE_MESSAGE = "O prémio já não existe. Recarregue a página.";

async function getOwnedCampaign(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({ where: { id: campaignId, organizationId, type: "WHEEL" } });
}

function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export async function addPrizeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addPrize", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const campaign = await getOwnedCampaign(context.organizationId, campaignId);
    if (!campaign) notFound();

    const parsed = prizeSchema.safeParse({
      internalName: getField(formData, "internalName"),
      publicName: getField(formData, "publicName"),
      description: getField(formData, "description"),
      imageMediaId: getField(formData, "imageMediaId"),
      totalQuantity: getField(formData, "totalQuantity"),
      dailyLimit: getField(formData, "dailyLimit"),
      instructions: getField(formData, "instructions"),
      terms: getField(formData, "terms"),
      // Sem a checkbox no pedido, fica ativo, como o valor por omissão da BD.
      isActive: readCheckbox(formData, "isActive") ?? true,
      startAt: getField(formData, "startAt"),
      endAt: getField(formData, "endAt"),
    });
    if (!parsed.success) return fail(INVALID_PRIZE_MESSAGE, zodFieldErrors(parsed.error));
    const data = parsed.data;

    const period = resolvePeriod({ start: data.startAt, end: data.endAt }, { start: null, end: null }, campaign.timezone);
    if (!period.ordered) return fail(INVALID_PRIZE_MESSAGE, { endAt: WHEEL_EDITOR_MESSAGES.periodOrder });

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const prize = await prisma.prize.create({
      data: {
        campaignId: campaign.id,
        internalName: data.internalName,
        publicName: data.publicName,
        description: data.description || null,
        imageMediaId: data.imageMediaId || null,
        totalQuantity: data.totalQuantity,
        dailyLimit: data.dailyLimit,
        instructions: data.instructions || null,
        terms: data.terms || null,
        isActive: data.isActive,
        startAt: period.start ?? null,
        endAt: period.end ?? null,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "Prize",
      entityId: prize.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${campaign.id}/jogo`);
    return ok("Prémio adicionado.");
  });
}

export async function updatePrizeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updatePrize", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const prizeId = readOptional(formData, "prizeId") ?? "";
    const campaign = await getOwnedCampaign(context.organizationId, campaignId);
    if (!campaign) notFound();

    const prize = await prisma.prize.findFirst({ where: { id: prizeId, campaignId: campaign.id } });
    if (!prize) notFound();

    // Só os campos que o formulário enviou: antes, o formulário de edição não
    // tinha descrição, imagem, termos nem datas, e gravar apagava-os.
    const parse = parsePartial(prizeShape, {
      internalName: readOptional(formData, "internalName"),
      publicName: readOptional(formData, "publicName"),
      description: readOptional(formData, "description"),
      imageMediaId: readOptional(formData, "imageMediaId"),
      totalQuantity: readOptional(formData, "totalQuantity"),
      dailyLimit: readOptional(formData, "dailyLimit"),
      instructions: readOptional(formData, "instructions"),
      terms: readOptional(formData, "terms"),
      isActive: readCheckbox(formData, "isActive"),
      startAt: readOptional(formData, "startAt"),
      endAt: readOptional(formData, "endAt"),
    });
    const { data } = parse;

    const period = resolvePeriod(
      { start: data.startAt, end: data.endAt },
      { start: prize.startAt, end: prize.endAt },
      campaign.timezone,
    );
    if (!period.ordered) rejectField(parse, "endAt", WHEEL_EDITOR_MESSAGES.periodOrder);

    // O que já saiu não se desfaz: um total abaixo disso deixava o stock
    // negativo. Volta a ver-se dentro da transação, contra rotações entretanto.
    // As reservas em curso também contam: são unidades que já saíram na roda
    // e passam a atribuídas quando a lead chegar.
    const reserved = (await activeReservationsByPrize([prize.id])).get(prize.id) ?? 0;
    if (data.totalQuantity != null && data.totalQuantity < prize.awardedQuantity + reserved) {
      rejectField(parse, "totalQuantity", prizeTotalBelowAwardedMessage(prize.awardedQuantity, reserved));
    }

    // Tudo ou nada, como no segmento: estado, datas e stock decidem o sorteio.
    if (Object.keys(parse.fieldErrors).length > 0) return fail(INVALID_PRIZE_MESSAGE, parse.fieldErrors);

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const update = {
      internalName: data.internalName,
      publicName: data.publicName,
      description: emptyToNull(data.description),
      imageMediaId: emptyToNull(data.imageMediaId),
      totalQuantity: data.totalQuantity,
      dailyLimit: data.dailyLimit,
      instructions: emptyToNull(data.instructions),
      terms: emptyToNull(data.terms),
      isActive: data.isActive,
      startAt: period.start,
      endAt: period.end,
    };
    if (!Object.values(update).some((value) => value !== undefined)) return ok();

    const saved = await runSerializable(async (tx) => {
      const before = await tx.prize.findUnique({ where: { id: prize.id } });
      if (!before) return { status: "gone" as const };
      const reservedNow = await tx.prizeAward.count({
        where: { prizeId: before.id, status: "RESERVED", reservationExpiresAt: { gt: new Date() } },
      });
      if (update.totalQuantity != null && update.totalQuantity < before.awardedQuantity + reservedNow) {
        return { status: "below_awarded" as const, awarded: before.awardedQuantity, reserved: reservedNow };
      }
      const after = await tx.prize.update({ where: { id: before.id }, data: update });
      return { status: "saved" as const, before, after };
    });
    if (saved.status === "gone") return fail(PRIZE_GONE_MESSAGE);
    if (saved.status === "below_awarded") {
      return fail(INVALID_PRIZE_MESSAGE, { totalQuantity: prizeTotalBelowAwardedMessage(saved.awarded, saved.reserved) });
    }
    const { before, after } = saved;

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "Prize",
      entityId: prize.id,
      result: "SUCCESS",
    });

    if (before.totalQuantity !== after.totalQuantity || before.dailyLimit !== after.dailyLimit) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "STOCK_CHANGE",
        entityType: "Prize",
        entityId: prize.id,
        result: "SUCCESS",
        metadata: {
          totalQuantityBefore: before.totalQuantity,
          totalQuantityAfter: after.totalQuantity,
          dailyLimitBefore: before.dailyLimit,
          dailyLimitAfter: after.dailyLimit,
        },
      });
    }

    // Desativar um prémio ou terminar o período tira os segmentos dele do
    // sorteio, e o peso deles passa para os outros: é uma mudança de
    // probabilidades (§26), mesmo sem mexer em nenhum peso.
    const oddsChanged =
      before.isActive !== after.isActive ||
      before.startAt?.getTime() !== after.startAt?.getTime() ||
      before.endAt?.getTime() !== after.endAt?.getTime();
    if (oddsChanged) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "ODDS_CHANGE",
        entityType: "Prize",
        entityId: prize.id,
        result: "SUCCESS",
        metadata: {
          isActiveBefore: before.isActive,
          isActiveAfter: after.isActive,
          startAtBefore: isoOrNull(before.startAt),
          startAtAfter: isoOrNull(after.startAt),
          endAtBefore: isoOrNull(before.endAt),
          endAtAfter: isoOrNull(after.endAt),
        },
      });
    }

    revalidatePath(`/apps/${campaign.id}/jogo`);
    return ok("Prémio guardado.");
  });
}

export async function removePrizeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removePrize", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const prizeId = getField(formData, "prizeId");
    const campaign = await getOwnedCampaign(context.organizationId, campaignId);
    if (!campaign) notFound();

    // A pertença é confirmada antes de qualquer escrita. Antes, os segmentos
    // eram desligados só pelo `prizeId` do formulário, sem filtro de campanha,
    // e um id alheio desligava os segmentos de outra organização.
    const prize = await prisma.prize.findFirst({
      where: { id: prizeId, campaignId: campaign.id },
      select: { id: true },
    });
    if (!prize) notFound();

    // Um prémio já atribuído não se elimina: o PrizeAward é o registo de quem
    // ganhou o quê, e a base de dados recusa-o (ON DELETE RESTRICT). O editor
    // não mostra o botão nesse caso; isto trava pedidos feitos à mão e a
    // página aberta antes da atribuição.
    const awarded = await prisma.prizeAward.findFirst({ where: { prizeId: prize.id }, select: { id: true } });
    if (awarded) return fail("Já atribuído, não pode ser eliminado.");

    // Os segmentos ligados ficam sem prémio pela própria chave estrangeira
    // (ON DELETE SET NULL), no mesmo comando — não há um passo intermédio que
    // possa ficar a meio.
    const deleted = await prisma.prize.deleteMany({ where: { id: prize.id, campaignId: campaign.id } });
    if (deleted.count === 0) return fail(PRIZE_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "Prize",
      entityId: prize.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${campaign.id}/jogo`);
    return ok();
  });
}

export async function addPrizeCodeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addPrizeCode", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const prizeId = getField(formData, "prizeId");
    const campaign = await getOwnedCampaign(context.organizationId, campaignId);
    if (!campaign) notFound();

    const prize = await prisma.prize.findFirst({ where: { id: prizeId, campaignId: campaign.id }, select: { id: true } });
    if (!prize) notFound();

    const parsed = prizeCodeSchema.safeParse({
      code: getField(formData, "code"),
      expiresAt: getField(formData, "expiresAt"),
    });
    if (!parsed.success) return fail(INVALID_CODE_MESSAGE, zodFieldErrors(parsed.error));

    // A validade é hora de parede no fuso da campanha (§22), como a agenda.
    const expiresAt = parsed.data.expiresAt ? zonedDateTimeToUtc(parsed.data.expiresAt, campaign.timezone) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return fail(INVALID_CODE_MESSAGE, { expiresAt: WHEEL_EDITOR_MESSAGES.codeExpired });
    }

    // Verifica-se antes para dar a mensagem no campo; a restrição única da BD
    // (prizeId, code) continua a valer num pedido concorrente (runAction).
    const duplicate = await prisma.prizeCode.findFirst({
      where: { prizeId: prize.id, code: parsed.data.code },
      select: { id: true },
    });
    if (duplicate) return fail(INVALID_CODE_MESSAGE, { code: WHEEL_EDITOR_MESSAGES.duplicateCode });

    const prizeCode = await prisma.prizeCode.create({
      data: { prizeId: prize.id, code: parsed.data.code, expiresAt },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CODE_CHANGE",
      entityType: "PrizeCode",
      entityId: prizeCode.id,
      result: "SUCCESS",
      metadata: { prizeId: prize.id, action: "create" },
    });

    revalidatePath(`/apps/${campaign.id}/jogo`);
    return ok("Código adicionado.");
  });
}

export async function removePrizeCodeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removePrizeCode", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const codeId = getField(formData, "codeId");
    const campaign = await getOwnedCampaign(context.organizationId, campaignId);
    if (!campaign) notFound();

    // Um código preso numa reserva que já expirou fica livre primeiro: só um
    // sorteio seguinte a libertava, e numa campanha terminada não há.
    const now = new Date();
    await runSerializable(async (tx) => {
      const stuck = await tx.prizeAward.findFirst({
        where: { prizeCodeId: codeId, status: "RESERVED", reservationExpiresAt: { lte: now }, prize: { campaignId: campaign.id } },
        select: { id: true, prizeCodeId: true, wheelSegmentId: true },
      });
      if (stuck) await releaseReservation(tx, stuck, "EXPIRED", now);
    });

    // Só códigos disponíveis: um reservado ou atribuído já tem dono.
    const deleted = await prisma.prizeCode.deleteMany({
      where: { id: codeId, status: "AVAILABLE", prize: { campaignId: campaign.id } },
    });
    if (deleted.count === 0) {
      return fail("O código já não está disponível: foi reservado ou atribuído entretanto.");
    }

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CODE_CHANGE",
      entityType: "PrizeCode",
      entityId: codeId,
      result: "SUCCESS",
      metadata: { action: "delete" },
    });

    revalidatePath(`/apps/${campaign.id}/jogo`);
    return ok();
  });
}
