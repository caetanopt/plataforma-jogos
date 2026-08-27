"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { brandThemeSchema } from "@/lib/validation/campaign";

async function getCampaignWithTheme(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { theme: true },
  });
}

export async function updateCampaignThemeAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
  if (!campaign || !campaign.theme) notFound();

  const parsed = brandThemeSchema.safeParse({
    name: formData.get("name"),
    logoMediaId: formData.get("logoMediaId"),
    faviconMediaId: formData.get("faviconMediaId"),
    backgroundImageMediaId: formData.get("backgroundImageMediaId"),
    primaryColor: formData.get("primaryColor"),
    secondaryColor: formData.get("secondaryColor"),
    backgroundColor: formData.get("backgroundColor"),
    textColor: formData.get("textColor"),
    buttonColor: formData.get("buttonColor"),
    buttonTextColor: formData.get("buttonTextColor"),
    fontFamily: formData.get("fontFamily"),
    borderRadiusPx: formData.get("borderRadiusPx"),
    shadowEnabled: formData.get("shadowEnabled") ?? "",
  });
  if (!parsed.success) return;

  await prisma.campaignTheme.update({
    where: { id: campaign.theme.id },
    data: {
      name: parsed.data.name,
      logoMediaId: parsed.data.logoMediaId || null,
      faviconMediaId: parsed.data.faviconMediaId || null,
      backgroundImageMediaId: parsed.data.backgroundImageMediaId || null,
      primaryColor: parsed.data.primaryColor,
      secondaryColor: parsed.data.secondaryColor,
      backgroundColor: parsed.data.backgroundColor,
      textColor: parsed.data.textColor,
      buttonColor: parsed.data.buttonColor,
      buttonTextColor: parsed.data.buttonTextColor,
      fontFamily: parsed.data.fontFamily,
      borderRadiusPx: parsed.data.borderRadiusPx,
      shadowEnabled: parsed.data.shadowEnabled === "on",
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "CampaignTheme",
    entityId: campaign.theme.id,
    result: "SUCCESS",
  });

  revalidatePath(`/apps/${campaignId}/marca`);
}

export async function saveAsBrandKitAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "brand:manage");

  const campaignId = String(formData.get("campaignId") ?? "");
  const kitName = String(formData.get("kitName") ?? "").trim();
  const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
  if (!campaign || !campaign.theme || !kitName) return;

  const kit = await prisma.campaignTheme.create({
    data: {
      organizationId: context.organizationId,
      name: kitName,
      isBrandKit: true,
      logoMediaId: campaign.theme.logoMediaId,
      faviconMediaId: campaign.theme.faviconMediaId,
      backgroundImageMediaId: campaign.theme.backgroundImageMediaId,
      primaryColor: campaign.theme.primaryColor,
      secondaryColor: campaign.theme.secondaryColor,
      backgroundColor: campaign.theme.backgroundColor,
      textColor: campaign.theme.textColor,
      buttonColor: campaign.theme.buttonColor,
      buttonTextColor: campaign.theme.buttonTextColor,
      fontFamily: campaign.theme.fontFamily,
      borderRadiusPx: campaign.theme.borderRadiusPx,
      shadowEnabled: campaign.theme.shadowEnabled,
      headerConfig: campaign.theme.headerConfig ?? undefined,
      footerConfig: campaign.theme.footerConfig ?? undefined,
      legalLinks: campaign.theme.legalLinks ?? undefined,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "CampaignTheme",
    entityId: kit.id,
    result: "SUCCESS",
    metadata: { brandKit: true },
  });

  revalidatePath(`/apps/${campaignId}/marca`);
  revalidatePath("/brand");
}

export async function applyBrandKitAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const brandKitId = String(formData.get("brandKitId") ?? "");

  const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
  const brandKit = await prisma.campaignTheme.findFirst({
    where: { id: brandKitId, organizationId: context.organizationId, isBrandKit: true },
  });
  if (!campaign || !campaign.theme || !brandKit) notFound();

  await prisma.campaignTheme.update({
    where: { id: campaign.theme.id },
    data: {
      sourceBrandKitId: brandKit.id,
      logoMediaId: brandKit.logoMediaId,
      faviconMediaId: brandKit.faviconMediaId,
      backgroundImageMediaId: brandKit.backgroundImageMediaId,
      primaryColor: brandKit.primaryColor,
      secondaryColor: brandKit.secondaryColor,
      backgroundColor: brandKit.backgroundColor,
      textColor: brandKit.textColor,
      buttonColor: brandKit.buttonColor,
      buttonTextColor: brandKit.buttonTextColor,
      fontFamily: brandKit.fontFamily,
      borderRadiusPx: brandKit.borderRadiusPx,
      shadowEnabled: brandKit.shadowEnabled,
      headerConfig: brandKit.headerConfig ?? undefined,
      footerConfig: brandKit.footerConfig ?? undefined,
      legalLinks: brandKit.legalLinks ?? undefined,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "CampaignTheme",
    entityId: campaign.theme.id,
    result: "SUCCESS",
    metadata: { appliedBrandKitId: brandKit.id },
  });

  revalidatePath(`/apps/${campaignId}/marca`);
}
