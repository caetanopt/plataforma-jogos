"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { intermediateScreenSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";

export async function updateIntermediateScreenAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = intermediateScreenSchema.safeParse({
    kind: getField(formData, "kind"),
    enabled: getField(formData, "enabled"),
    title: getField(formData, "title"),
    text: getField(formData, "text"),
    mediaId: getField(formData, "mediaId"),
    ctaLabel: getField(formData, "ctaLabel"),
    ctaUrl: getField(formData, "ctaUrl"),
    continueButtonLabel: getField(formData, "continueButtonLabel"),
  });
  if (!parsed.success) return;

  const { kind, enabled } = parsed.data;

  if (enabled === "on") {
    await prisma.campaignScreen.upsert({
      where: { campaignId_kind: { campaignId, kind } },
      create: {
        campaignId,
        kind,
        title: parsed.data.title || null,
        text: parsed.data.text || null,
        mediaId: parsed.data.mediaId || null,
        ctaLabel: parsed.data.ctaLabel || null,
        ctaUrl: parsed.data.ctaUrl || null,
        continueButtonLabel: parsed.data.continueButtonLabel || null,
      },
      update: {
        title: parsed.data.title || null,
        text: parsed.data.text || null,
        mediaId: parsed.data.mediaId || null,
        ctaLabel: parsed.data.ctaLabel || null,
        ctaUrl: parsed.data.ctaUrl || null,
        continueButtonLabel: parsed.data.continueButtonLabel || null,
      },
    });
  } else {
    await prisma.campaignScreen.deleteMany({ where: { campaignId, kind } });
  }

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { step: "ecra-intermedio", kind },
  });

  revalidatePath(`/apps/${campaignId}/ecra-intermedio`);
}
