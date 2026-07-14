"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { scheduleSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";

export async function updateScheduleAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = scheduleSchema.safeParse({
    scheduleStartAt: getField(formData, "scheduleStartAt"),
    scheduleEndAt: getField(formData, "scheduleEndAt"),
    scheduleBeforeMessage: getField(formData, "scheduleBeforeMessage"),
    scheduleAfterMessage: getField(formData, "scheduleAfterMessage"),
    scheduleRedirectUrl: getField(formData, "scheduleRedirectUrl"),
  });
  if (!parsed.success) return;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      scheduleStartAt: parsed.data.scheduleStartAt ? new Date(parsed.data.scheduleStartAt) : null,
      scheduleEndAt: parsed.data.scheduleEndAt ? new Date(parsed.data.scheduleEndAt) : null,
      scheduleBeforeMessage: parsed.data.scheduleBeforeMessage || null,
      scheduleAfterMessage: parsed.data.scheduleAfterMessage || null,
      scheduleRedirectUrl: parsed.data.scheduleRedirectUrl || null,
    },
  });

  revalidatePath(`/apps/${campaignId}/agenda`);
}
