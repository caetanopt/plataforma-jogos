"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { memoryConfigShape, memoryPairSchema } from "@/lib/validation/memory-game";
import { emptyToNull, getField, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { fail, ok, partialResult, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";
const PAIR_GONE_MESSAGE = "Este par já não existe. Recarregue a página.";

async function getOwnedMemoryConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "MEMORY" },
    include: { memoryConfig: true },
  });
  return campaign?.memoryConfig ? { campaign, memoryConfig: campaign.memoryConfig } : null;
}

export async function updateMemoryConfigAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateMemoryConfig", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    // Campo a campo: apagar "Colunas" para escrever outro número já não
    // grava 0 nem deita fora o resto do formulário.
    const { data, fieldErrors } = parsePartial(memoryConfigShape, {
      columns: readOptional(formData, "columns"),
      randomizeOrder: readCheckbox(formData, "randomizeOrder"),
      cardAspectRatio: readOptional(formData, "cardAspectRatio"),
      cardGapPx: readOptional(formData, "cardGapPx"),
      timeLimitSeconds: readOptional(formData, "timeLimitSeconds"),
      maxAttempts: readOptional(formData, "maxAttempts"),
      pointsPerPair: readOptional(formData, "pointsPerPair"),
      penaltyPerMistake: readOptional(formData, "penaltyPerMistake"),
      speedBonusEnabled: readCheckbox(formData, "speedBonusEnabled"),
      previewSeconds: readOptional(formData, "previewSeconds"),
      soundEnabled: readCheckbox(formData, "soundEnabled"),
      rankingEnabled: readCheckbox(formData, "rankingEnabled"),
      rankingMaxEntries: readOptional(formData, "rankingMaxEntries"),
      rankingAnonymize: readCheckbox(formData, "rankingAnonymize"),
      cardBackMediaId: readOptional(formData, "cardBackMediaId"),
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.cardBackMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const update = {
      columns: data.columns,
      randomizeOrder: data.randomizeOrder,
      cardAspectRatio: data.cardAspectRatio,
      cardGapPx: data.cardGapPx,
      timeLimitSeconds: data.timeLimitSeconds,
      maxAttempts: data.maxAttempts,
      pointsPerPair: data.pointsPerPair,
      penaltyPerMistake: data.penaltyPerMistake,
      speedBonusEnabled: data.speedBonusEnabled,
      previewSeconds: data.previewSeconds,
      soundEnabled: data.soundEnabled,
      rankingEnabled: data.rankingEnabled,
      rankingMaxEntries: data.rankingMaxEntries,
      rankingAnonymize: data.rankingAnonymize,
      cardBackMediaId: emptyToNull(data.cardBackMediaId),
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);
    if (!savedSomething) return partialResult(fieldErrors, false);

    await prisma.memoryGameConfig.update({ where: { id: owned.memoryConfig.id }, data: update });

    // Só se audita quando um campo da pontuação/mecânica muda — esta ação
    // dispara em cada alteração de autosave, e auditar sempre (incluindo
    // campos cosméticos como o espaçamento) inundaria o registo. Um campo
    // que não foi gravado (inválido ou não enviado) fica com o valor antigo.
    const before = owned.memoryConfig;
    const after = {
      timeLimitSeconds: update.timeLimitSeconds === undefined ? before.timeLimitSeconds : update.timeLimitSeconds,
      maxAttempts: update.maxAttempts === undefined ? before.maxAttempts : update.maxAttempts,
      pointsPerPair: update.pointsPerPair ?? before.pointsPerPair,
      penaltyPerMistake: update.penaltyPerMistake ?? before.penaltyPerMistake,
      speedBonusEnabled: update.speedBonusEnabled ?? before.speedBonusEnabled,
    };
    const scoringChanged =
      after.timeLimitSeconds !== before.timeLimitSeconds ||
      after.maxAttempts !== before.maxAttempts ||
      after.pointsPerPair !== before.pointsPerPair ||
      after.penaltyPerMistake !== before.penaltyPerMistake ||
      after.speedBonusEnabled !== before.speedBonusEnabled;

    if (scoringChanged) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "MemoryGameConfig",
        entityId: owned.memoryConfig.id,
        result: "SUCCESS",
        metadata: {
          timeLimitSecondsBefore: before.timeLimitSeconds,
          timeLimitSecondsAfter: after.timeLimitSeconds,
          maxAttemptsBefore: before.maxAttempts,
          maxAttemptsAfter: after.maxAttempts,
          pointsPerPairBefore: before.pointsPerPair,
          pointsPerPairAfter: after.pointsPerPair,
          penaltyPerMistakeBefore: before.penaltyPerMistake,
          penaltyPerMistakeAfter: after.penaltyPerMistake,
          speedBonusEnabledBefore: before.speedBonusEnabled,
          speedBonusEnabledAfter: after.speedBonusEnabled,
        },
      });
    }

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return partialResult(fieldErrors, true);
  });
}

export async function addMemoryPairAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addMemoryPair", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    // Criação: um campo que o tipo escolhido não mostra vale o mesmo que vazio.
    const parsed = memoryPairSchema.safeParse({
      kind: getField(formData, "kind"),
      cardAMediaId: getField(formData, "cardAMediaId"),
      cardAText: getField(formData, "cardAText"),
      cardAAltText: getField(formData, "cardAAltText"),
      cardBMediaId: getField(formData, "cardBMediaId"),
      cardBText: getField(formData, "cardBText"),
      cardBAltText: getField(formData, "cardBAltText"),
    });
    if (!parsed.success) {
      return fail("O par não foi adicionado.", zodFieldErrors(parsed.error));
    }
    const pair = parsed.data;

    // Cada carta guarda só o que o seu tipo usa: um texto de outro tipo
    // (escolhido e depois trocado) não aparece no jogo por baixo da imagem.
    const aIsImage = pair.kind !== "TEXT_TEXT";
    const bIsImage = pair.kind === "SAME_IMAGE" || pair.kind === "DIFFERENT_IMAGE_MATCH";
    const cardAMediaId = aIsImage ? pair.cardAMediaId : "";
    const cardBMediaId =
      pair.kind === "SAME_IMAGE" ? pair.cardAMediaId : pair.kind === "DIFFERENT_IMAGE_MATCH" ? pair.cardBMediaId : "";

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [cardAMediaId, cardBMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const last = await prisma.memoryCardPair.findFirst({
      where: { memoryGameConfigId: owned.memoryConfig.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const created = await prisma.memoryCardPair.create({
      data: {
        memoryGameConfigId: owned.memoryConfig.id,
        order: (last?.order ?? -1) + 1,
        kind: pair.kind,
        cardAMediaId: cardAMediaId || null,
        cardAText: aIsImage ? null : pair.cardAText || null,
        cardAAltText: aIsImage ? pair.cardAAltText || null : null,
        cardBMediaId: cardBMediaId || null,
        cardBText: bIsImage ? null : pair.cardBText || null,
        cardBAltText: bIsImage ? pair.cardBAltText || null : null,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "MemoryCardPair",
      entityId: created.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Par adicionado.");
  });
}

export async function removeMemoryPairAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeMemoryPair", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const pairId = getField(formData, "pairId");
    const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const deleted = await prisma.memoryCardPair.deleteMany({
      where: { id: pairId, memoryGameConfigId: owned.memoryConfig.id },
    });
    if (deleted.count === 0) return fail(PAIR_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "MemoryCardPair",
      entityId: pairId,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function moveMemoryPairAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("moveMemoryPair", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const pairId = getField(formData, "pairId");
    const direction = getField(formData, "direction");
    const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    if (direction !== "up" && direction !== "down") return fail("Direção inválida. Recarregue a página.");

    const pairs = await prisma.memoryCardPair.findMany({
      where: { memoryGameConfigId: owned.memoryConfig.id },
      orderBy: { order: "asc" },
    });
    const index = pairs.findIndex((p) => p.id === pairId);
    if (index === -1) return fail(PAIR_GONE_MESSAGE);

    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0) return fail("O par já é o primeiro da lista.");
    if (swapIndex >= pairs.length) return fail("O par já é o último da lista.");

    const current = pairs[index];
    const swapWith = pairs[swapIndex];

    await prisma.$transaction([
      prisma.memoryCardPair.update({ where: { id: current.id }, data: { order: swapWith.order } }),
      prisma.memoryCardPair.update({ where: { id: swapWith.id }, data: { order: current.order } }),
    ]);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "MemoryCardPair",
      entityId: current.id,
      result: "SUCCESS",
      metadata: { action: "reorder", swappedWith: swapWith.id },
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}
