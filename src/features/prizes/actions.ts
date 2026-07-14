"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
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

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removePrizeAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const prizeId = getField(formData, "prizeId");
  const campaign = await getOwnedCampaign(context.organizationId, campaignId);
  if (!campaign) notFound();

  await prisma.wheelSegment.updateMany({ where: { prizeId }, data: { prizeId: null } });
  await prisma.prize.deleteMany({ where: { id: prizeId, campaignId } });

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

  await prisma.prizeCode.create({
    data: {
      prizeId,
      code: parsed.data.code,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
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

  await prisma.prizeCode.deleteMany({ where: { id: codeId, status: "AVAILABLE", prize: { campaignId } } });

  revalidatePath(`/apps/${campaignId}/jogo`);
}
