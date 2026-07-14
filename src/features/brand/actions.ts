"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { brandThemeSchema } from "@/lib/validation/campaign";

export async function createBrandKitAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "brand:manage");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const kit = await prisma.campaignTheme.create({
    data: { organizationId: context.organizationId, name, isBrandKit: true },
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

  revalidatePath("/brand");
}

export async function updateBrandKitAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "brand:manage");

  const kitId = String(formData.get("kitId") ?? "");
  const kit = await prisma.campaignTheme.findFirst({
    where: { id: kitId, organizationId: context.organizationId, isBrandKit: true },
  });
  if (!kit) notFound();

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
    where: { id: kitId },
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
    entityId: kitId,
    result: "SUCCESS",
  });

  revalidatePath("/brand");
}

export async function deleteBrandKitAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "brand:manage");

  const kitId = String(formData.get("kitId") ?? "");
  const kit = await prisma.campaignTheme.findFirst({
    where: { id: kitId, organizationId: context.organizationId, isBrandKit: true },
  });
  if (!kit) notFound();

  await prisma.campaignTheme.delete({ where: { id: kitId } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "DELETE",
    entityType: "CampaignTheme",
    entityId: kitId,
    result: "SUCCESS",
  });

  revalidatePath("/brand");
}
