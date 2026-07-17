"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { memoryConfigSchema, memoryPairSchema } from "@/lib/validation/memory-game";
import { getField } from "@/lib/forms/form-data";

async function getOwnedMemoryConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "MEMORY" },
    include: { memoryConfig: true },
  });
  return campaign?.memoryConfig ? { campaign, memoryConfig: campaign.memoryConfig } : null;
}

export async function updateMemoryConfigAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = memoryConfigSchema.safeParse({
    columns: formData.get("columns"),
    randomizeOrder: formData.get("randomizeOrder") ?? "",
    cardAspectRatio: formData.get("cardAspectRatio"),
    cardGapPx: formData.get("cardGapPx"),
    timeLimitSeconds: formData.get("timeLimitSeconds") || undefined,
    maxAttempts: formData.get("maxAttempts") || undefined,
    pointsPerPair: formData.get("pointsPerPair"),
    penaltyPerMistake: formData.get("penaltyPerMistake"),
    speedBonusEnabled: formData.get("speedBonusEnabled") ?? "",
    previewSeconds: formData.get("previewSeconds") || undefined,
    soundEnabled: formData.get("soundEnabled") ?? "",
    rankingEnabled: formData.get("rankingEnabled") ?? "",
    rankingMaxEntries: formData.get("rankingMaxEntries") || undefined,
    rankingAnonymize: formData.get("rankingAnonymize") ?? "",
    cardBackMediaId: formData.get("cardBackMediaId"),
  });
  if (!parsed.success) return;

  const timeLimitSeconds = parsed.data.timeLimitSeconds ?? null;
  const maxAttempts = parsed.data.maxAttempts ?? null;
  const pointsPerPair = parsed.data.pointsPerPair;
  const penaltyPerMistake = parsed.data.penaltyPerMistake;
  const speedBonusEnabled = parsed.data.speedBonusEnabled === "on";

  // Só se audita quando um campo relevante para a pontuação/mecânica muda —
  // esta action dispara em cada alteração de autosave, e auditar sempre
  // (incluindo campos cosméticos como cor/espaçamento) inundaria o registo.
  const scoringChanged =
    timeLimitSeconds !== owned.memoryConfig.timeLimitSeconds ||
    maxAttempts !== owned.memoryConfig.maxAttempts ||
    pointsPerPair !== owned.memoryConfig.pointsPerPair ||
    penaltyPerMistake !== owned.memoryConfig.penaltyPerMistake ||
    speedBonusEnabled !== owned.memoryConfig.speedBonusEnabled;

  await prisma.memoryGameConfig.update({
    where: { id: owned.memoryConfig.id },
    data: {
      columns: parsed.data.columns,
      randomizeOrder: parsed.data.randomizeOrder === "on",
      cardAspectRatio: parsed.data.cardAspectRatio,
      cardGapPx: parsed.data.cardGapPx,
      timeLimitSeconds,
      maxAttempts,
      pointsPerPair,
      penaltyPerMistake,
      speedBonusEnabled,
      previewSeconds: parsed.data.previewSeconds ?? null,
      soundEnabled: parsed.data.soundEnabled === "on",
      rankingEnabled: parsed.data.rankingEnabled === "on",
      rankingMaxEntries: parsed.data.rankingMaxEntries ?? null,
      rankingAnonymize: parsed.data.rankingAnonymize === "on",
      cardBackMediaId: parsed.data.cardBackMediaId || null,
    },
  });

  if (scoringChanged) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "MemoryGameConfig",
      entityId: owned.memoryConfig.id,
      result: "SUCCESS",
      metadata: {
        timeLimitSecondsBefore: owned.memoryConfig.timeLimitSeconds,
        timeLimitSecondsAfter: timeLimitSeconds,
        maxAttemptsBefore: owned.memoryConfig.maxAttempts,
        maxAttemptsAfter: maxAttempts,
        pointsPerPairBefore: owned.memoryConfig.pointsPerPair,
        pointsPerPairAfter: pointsPerPair,
        penaltyPerMistakeBefore: owned.memoryConfig.penaltyPerMistake,
        penaltyPerMistakeAfter: penaltyPerMistake,
      },
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function addMemoryPairAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = memoryPairSchema.safeParse({
    kind: getField(formData, "kind"),
    cardAMediaId: getField(formData, "cardAMediaId"),
    cardAText: getField(formData, "cardAText"),
    cardAAltText: getField(formData, "cardAAltText"),
    cardBMediaId: getField(formData, "cardBMediaId"),
    cardBText: getField(formData, "cardBText"),
    cardBAltText: getField(formData, "cardBAltText"),
  });
  if (!parsed.success) return;

  const existing = await prisma.memoryCardPair.findMany({
    where: { memoryGameConfigId: owned.memoryConfig.id },
    select: { order: true },
  });
  const nextOrder = existing.reduce((max, p) => Math.max(max, p.order), -1) + 1;

  const cardBMediaId =
    parsed.data.kind === "SAME_IMAGE" ? parsed.data.cardAMediaId : parsed.data.cardBMediaId;

  const pair = await prisma.memoryCardPair.create({
    data: {
      memoryGameConfigId: owned.memoryConfig.id,
      order: nextOrder,
      kind: parsed.data.kind,
      cardAMediaId: parsed.data.cardAMediaId || null,
      cardAText: parsed.data.cardAText || null,
      cardAAltText: parsed.data.cardAAltText || null,
      cardBMediaId: cardBMediaId || null,
      cardBText: parsed.data.cardBText || null,
      cardBAltText: parsed.data.cardBAltText || null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "MemoryCardPair",
    entityId: pair.id,
    result: "SUCCESS",
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removeMemoryPairAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const pairId = String(formData.get("pairId") ?? "");
  const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const deleted = await prisma.memoryCardPair.deleteMany({
    where: { id: pairId, memoryGameConfigId: owned.memoryConfig.id },
  });

  if (deleted.count > 0) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "MemoryCardPair",
      entityId: pairId,
      result: "SUCCESS",
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function moveMemoryPairAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const pairId = String(formData.get("pairId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const owned = await getOwnedMemoryConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const pairs = await prisma.memoryCardPair.findMany({
    where: { memoryGameConfigId: owned.memoryConfig.id },
    orderBy: { order: "asc" },
  });
  const index = pairs.findIndex((p) => p.id === pairId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= pairs.length) return;

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

  revalidatePath(`/apps/${campaignId}/jogo`);
}
