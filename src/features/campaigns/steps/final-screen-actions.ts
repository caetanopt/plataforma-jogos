"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { finalScreenSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";

export async function updateFinalScreenAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = finalScreenSchema.safeParse({
    finalTitle: getField(formData, "finalTitle"),
    finalMessage: getField(formData, "finalMessage"),
    finalMediaId: getField(formData, "finalMediaId"),
    finalCtaLabel: getField(formData, "finalCtaLabel"),
    finalCtaUrl: getField(formData, "finalCtaUrl"),
    finalAllowReplay: getField(formData, "finalAllowReplay"),
    finalAllowShare: getField(formData, "finalAllowShare"),
  });
  if (!parsed.success) return;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      finalTitle: parsed.data.finalTitle || null,
      finalMessage: parsed.data.finalMessage || null,
      finalMediaId: parsed.data.finalMediaId || null,
      finalCtaLabel: parsed.data.finalCtaLabel || null,
      finalCtaUrl: parsed.data.finalCtaUrl || null,
      finalAllowReplay: parsed.data.finalAllowReplay === "on",
      finalAllowShare: parsed.data.finalAllowShare === "on",
    },
  });

  revalidatePath(`/apps/${campaignId}/ecra-final`);
}
