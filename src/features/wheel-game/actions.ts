"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { wheelSegmentSchema } from "@/lib/validation/wheel-game";
import { getField } from "@/lib/forms/form-data";

async function getOwnedWheelConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "WHEEL" },
    include: { wheelConfig: true },
  });
  return campaign?.wheelConfig ? { campaign, wheelConfig: campaign.wheelConfig } : null;
}

function parseSegmentForm(formData: FormData) {
  return wheelSegmentSchema.safeParse({
    name: getField(formData, "name"),
    colorHex: getField(formData, "colorHex"),
    imageMediaId: getField(formData, "imageMediaId"),
    outcome: getField(formData, "outcome"),
    prizeId: getField(formData, "prizeId"),
    weight: getField(formData, "weight"),
    totalQuantity: getField(formData, "totalQuantity") || undefined,
    periodStart: getField(formData, "periodStart"),
    periodEnd: getField(formData, "periodEnd"),
    message: getField(formData, "message"),
    code: getField(formData, "code"),
    isActive: getField(formData, "isActive"),
  });
}

export async function addWheelSegmentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = parseSegmentForm(formData);
  if (!parsed.success) return;

  const existing = await prisma.wheelSegment.findMany({
    where: { wheelConfigId: owned.wheelConfig.id },
    select: { order: true },
  });
  const nextOrder = existing.reduce((max, s) => Math.max(max, s.order), -1) + 1;

  const prizeId = parsed.data.outcome === "WIN" && parsed.data.prizeId ? parsed.data.prizeId : null;

  await prisma.wheelSegment.create({
    data: {
      wheelConfigId: owned.wheelConfig.id,
      order: nextOrder,
      name: parsed.data.name,
      colorHex: parsed.data.colorHex,
      imageMediaId: parsed.data.imageMediaId || null,
      outcome: parsed.data.outcome,
      prizeId,
      weight: parsed.data.weight,
      totalQuantity: parsed.data.totalQuantity ?? null,
      remainingQuantity: parsed.data.totalQuantity ?? null,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : null,
      periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null,
      message: parsed.data.message || null,
      code: parsed.data.code || null,
      isActive: parsed.data.isActive === "on",
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "WheelSegment",
    entityId: owned.wheelConfig.id,
    result: "SUCCESS",
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function updateWheelSegmentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const segmentId = getField(formData, "segmentId");
  const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const segment = await prisma.wheelSegment.findFirst({
    where: { id: segmentId, wheelConfigId: owned.wheelConfig.id },
  });
  if (!segment) notFound();

  const parsed = parseSegmentForm(formData);
  if (!parsed.success) return;

  const prizeId = parsed.data.outcome === "WIN" && parsed.data.prizeId ? parsed.data.prizeId : null;

  // Ajusta o stock restante proporcionalmente se o total for alterado, preservando o já atribuído.
  const awarded = segment.totalQuantity != null ? segment.totalQuantity - (segment.remainingQuantity ?? 0) : 0;
  const newRemaining = parsed.data.totalQuantity != null ? Math.max(0, parsed.data.totalQuantity - awarded) : null;

  const weightChanged = parsed.data.weight !== segment.weight;
  const stockChanged = parsed.data.totalQuantity !== (segment.totalQuantity ?? undefined);

  await prisma.wheelSegment.update({
    where: { id: segmentId },
    data: {
      name: parsed.data.name,
      colorHex: parsed.data.colorHex,
      imageMediaId: parsed.data.imageMediaId || null,
      outcome: parsed.data.outcome,
      prizeId,
      weight: parsed.data.weight,
      totalQuantity: parsed.data.totalQuantity ?? null,
      remainingQuantity: newRemaining,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : null,
      periodEnd: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : null,
      message: parsed.data.message || null,
      code: parsed.data.code || null,
      isActive: parsed.data.isActive === "on",
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "WheelSegment",
    entityId: segmentId,
    result: "SUCCESS",
  });

  if (weightChanged) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "ODDS_CHANGE",
      entityType: "WheelSegment",
      entityId: segmentId,
      result: "SUCCESS",
      metadata: { weightBefore: segment.weight, weightAfter: parsed.data.weight },
    });
  }

  if (stockChanged) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "STOCK_CHANGE",
      entityType: "WheelSegment",
      entityId: segmentId,
      result: "SUCCESS",
      metadata: {
        totalQuantityBefore: segment.totalQuantity,
        totalQuantityAfter: parsed.data.totalQuantity ?? null,
      },
    });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removeWheelSegmentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const segmentId = getField(formData, "segmentId");
  const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  await prisma.wheelSegment.deleteMany({ where: { id: segmentId, wheelConfigId: owned.wheelConfig.id } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "DELETE",
    entityType: "WheelSegment",
    entityId: segmentId,
    result: "SUCCESS",
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function moveWheelSegmentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const segmentId = getField(formData, "segmentId");
  const direction = getField(formData, "direction");
  const owned = await getOwnedWheelConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const segments = await prisma.wheelSegment.findMany({
    where: { wheelConfigId: owned.wheelConfig.id },
    orderBy: { order: "asc" },
  });
  const index = segments.findIndex((s) => s.id === segmentId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= segments.length) return;

  const current = segments[index];
  const swapWith = segments[swapIndex];

  await prisma.$transaction([
    prisma.wheelSegment.update({ where: { id: current.id }, data: { order: swapWith.order } }),
    prisma.wheelSegment.update({ where: { id: swapWith.id }, data: { order: current.order } }),
  ]);

  revalidatePath(`/apps/${campaignId}/jogo`);
}
