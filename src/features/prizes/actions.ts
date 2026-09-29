"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { prizeCodeSchema, prizeSchema } from "@/lib/validation/wheel-game";
import { getField } from "@/lib/forms/form-data";

async function getOwnedCampaign(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({ where: { id: campaignId, organizationId, type: "WHEEL" } });
}

export async function addPrizeAction(formData: FormData): Promise<void> {
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
    totalQuantity: getField(formData, "totalQuantity") || undefined,
    dailyLimit: getField(formData, "dailyLimit") || undefined,
    instructions: getField(formData, "instructions"),
    terms: getField(formData, "terms"),
    isActive: getField(formData, "isActive"),
    startAt: getField(formData, "startAt"),
    endAt: getField(formData, "endAt"),
  });
  if (!parsed.success) return;
  // Só media da própria organização (ver mediaBelongsToOrganization).
  if (!(await mediaBelongsToOrganization(context.organizationId, [parsed.data.imageMediaId]))) return;

  const prize = await prisma.prize.create({
    data: {
      campaignId,
      internalName: parsed.data.internalName,
      publicName: parsed.data.publicName,
      description: parsed.data.description || null,
      imageMediaId: parsed.data.imageMediaId || null,
      totalQuantity: parsed.data.totalQuantity ?? null,
      dailyLimit: parsed.data.dailyLimit ?? null,
      instructions: parsed.data.instructions || null,
      terms: parsed.data.terms || null,
      isActive: parsed.data.isActive === "on",
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
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

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function updatePrizeAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const prizeId = getField(formData, "prizeId");
  const campaign = await getOwnedCampaign(context.organizationId, campaignId);
  if (!campaign) notFound();

  const prize = await prisma.prize.findFirst({ where: { id: prizeId, campaignId } });
  if (!prize) notFound();

  const parsed = prizeSchema.safeParse({
    internalName: getField(formData, "internalName"),
    publicName: getField(formData, "publicName"),
    description: getField(formData, "description"),
    imageMediaId: getField(formData, "imageMediaId"),
    totalQuantity: getField(formData, "totalQuantity") || undefined,
    dailyLimit: getField(formData, "dailyLimit") || undefined,
    instructions: getField(formData, "instructions"),
    terms: getField(formData, "terms"),
    isActive: getField(formData, "isActive"),
    startAt: getField(formData, "startAt"),
    endAt: getField(formData, "endAt"),
  });
  if (!parsed.success) return;
  // Só media da própria organização (ver mediaBelongsToOrganization).
  if (!(await mediaBelongsToOrganization(context.organizationId, [parsed.data.imageMediaId]))) return;

  const quantityChanged =
    parsed.data.totalQuantity !== (prize.totalQuantity ?? undefined) ||
    parsed.data.dailyLimit !== (prize.dailyLimit ?? undefined);

  await prisma.prize.update({
    where: { id: prizeId },
    data: {
      internalName: parsed.data.internalName,
      publicName: parsed.data.publicName,
      description: parsed.data.description || null,
      imageMediaId: parsed.data.imageMediaId || null,
      totalQuantity: parsed.data.totalQuantity ?? null,
      dailyLimit: parsed.data.dailyLimit ?? null,
      instructions: parsed.data.instructions || null,
      terms: parsed.data.terms || null,
      isActive: parsed.data.isActive === "on",
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Prize",
    entityId: prizeId,
    result: "SUCCESS",
  });

  if (quantityChanged) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "STOCK_CHANGE",
      entityType: "Prize",
      entityId: prizeId,
      result: "SUCCESS",
      metadata: {
        totalQuantityBefore: prize.totalQuantity,
        totalQuantityAfter: parsed.data.totalQuantity ?? null,
        dailyLimitBefore: prize.dailyLimit,
        dailyLimitAfter: parsed.data.dailyLimit ?? null,
      },
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removePrizeAction(formData: FormData): Promise<void> {
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
    where: { id: prizeId, campaignId },
    select: { id: true, _count: { select: { awards: true } } },
  });
  if (!prize) notFound();

  // Um prémio já atribuído não se elimina: o PrizeAward é o registo de quem
  // ganhou o quê, e a base de dados recusa-o (ON DELETE RESTRICT). O editor
  // não mostra o botão nesse caso; isto trava pedidos feitos à mão.
  if (prize._count.awards > 0) return;

  // Os segmentos ligados ficam sem prémio pela própria chave estrangeira
  // (ON DELETE SET NULL), no mesmo comando — não há um passo intermédio que
  // possa ficar a meio.
  const deleted = await prisma.prize.deleteMany({ where: { id: prize.id, campaignId } });

  if (deleted.count > 0) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "Prize",
      entityId: prizeId,
      result: "SUCCESS",
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function addPrizeCodeAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const prizeId = getField(formData, "prizeId");
  const campaign = await getOwnedCampaign(context.organizationId, campaignId);
  if (!campaign) notFound();

  const prize = await prisma.prize.findFirst({ where: { id: prizeId, campaignId } });
  if (!prize) notFound();

  const parsed = prizeCodeSchema.safeParse({
    code: getField(formData, "code"),
    expiresAt: getField(formData, "expiresAt"),
  });
  if (!parsed.success) return;

  const prizeCode = await prisma.prizeCode.create({
    data: {
      prizeId,
      code: parsed.data.code,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CODE_CHANGE",
    entityType: "PrizeCode",
    entityId: prizeCode.id,
    result: "SUCCESS",
    metadata: { prizeId, action: "create" },
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removePrizeCodeAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const codeId = getField(formData, "codeId");
  const campaign = await getOwnedCampaign(context.organizationId, campaignId);
  if (!campaign) notFound();

  const deleted = await prisma.prizeCode.deleteMany({
    where: { id: codeId, status: "AVAILABLE", prize: { campaignId } },
  });

  if (deleted.count > 0) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CODE_CHANGE",
      entityType: "PrizeCode",
      entityId: codeId,
      result: "SUCCESS",
      metadata: { action: "delete" },
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}
