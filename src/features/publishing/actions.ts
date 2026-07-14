"use server";

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getPublishReadiness } from "@/features/publishing/readiness";
import { generateAndStoreQrCodes } from "@/features/publishing/qr";

function publicPlayUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/play/${slug}`;
}

export async function publishCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await getCampaignForEditor(context.organizationId, campaignId);
  if (!campaign) notFound();

  const readiness = getPublishReadiness(campaign);
  if (!readiness.ready) {
    redirect(`/apps/${campaignId}/publicar?error=readiness`);
  }

  const now = new Date();
  const nextStatus = campaign.scheduleStartAt && campaign.scheduleStartAt > now ? "SCHEDULED" : "PUBLISHED";

  const lastVersion = await prisma.campaignVersion.findFirst({
    where: { campaignId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const snapshot = JSON.parse(JSON.stringify(campaign));

  const version = await prisma.campaignVersion.create({
    data: {
      campaignId,
      versionNumber,
      snapshot,
      publishedById: context.userId,
    },
  });

  const url = publicPlayUrl(campaign.slug);
  const { pngMediaId, svgMediaId } = await generateAndStoreQrCodes(context.organizationId, context.userId, url);

  await prisma.publication.create({
    data: {
      campaignVersionId: version.id,
      publishedById: context.userId,
      qrPngMediaId: pngMediaId,
      qrSvgMediaId: svgMediaId,
    },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: nextStatus, publishedAt: now },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PUBLISH",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { versionNumber, status: nextStatus },
  });

  revalidatePath(`/apps/${campaignId}/publicar`);
  revalidatePath("/apps");
}

export async function unpublishCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "DRAFT" } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { action: "unpublish" },
  });

  revalidatePath(`/apps/${campaignId}/publicar`);
  revalidatePath("/apps");
}
