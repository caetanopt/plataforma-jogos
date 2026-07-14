"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { startScreenSchema } from "@/lib/validation/campaign";

export async function updateStartScreenAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = startScreenSchema.safeParse({
    startTitle: formData.get("startTitle"),
    startSubtitle: formData.get("startSubtitle"),
    startIntroText: formData.get("startIntroText"),
    startMediaId: formData.get("startMediaId"),
    startLogoMediaId: formData.get("startLogoMediaId"),
    startButtonLabel: formData.get("startButtonLabel"),
    startPrizeInfo: formData.get("startPrizeInfo"),
    countdownEnabled: formData.get("countdownEnabled") ?? "",
    regulationText: formData.get("regulationText"),
    legalText: formData.get("legalText"),
  });
  if (!parsed.success) return;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      startTitle: parsed.data.startTitle || null,
      startSubtitle: parsed.data.startSubtitle || null,
      startIntroText: parsed.data.startIntroText || null,
      startMediaId: parsed.data.startMediaId || null,
      startLogoMediaId: parsed.data.startLogoMediaId || null,
      startButtonLabel: parsed.data.startButtonLabel || null,
      startPrizeInfo: parsed.data.startPrizeInfo || null,
      countdownEnabled: parsed.data.countdownEnabled === "on",
      regulationText: parsed.data.regulationText || null,
      legalText: parsed.data.legalText || null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { step: "ecra-inicial" },
  });

  revalidatePath(`/apps/${campaignId}/ecra-inicial`);
}
