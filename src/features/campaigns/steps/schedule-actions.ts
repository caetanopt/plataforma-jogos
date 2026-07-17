"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { scheduleSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";
import { zonedDateTimeToUtc } from "@/lib/dates/timezone";

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

  // A hora vem do <input type="datetime-local"> como hora "de parede", sem
  // fuso — tem de ser interpretada no fuso da campanha, não no fuso do
  // processo do servidor (new Date(str) usaria este último).
  const scheduleStartAt = parsed.data.scheduleStartAt
    ? zonedDateTimeToUtc(parsed.data.scheduleStartAt, campaign.timezone)
    : null;
  const scheduleEndAt = parsed.data.scheduleEndAt
    ? zonedDateTimeToUtc(parsed.data.scheduleEndAt, campaign.timezone)
    : null;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      scheduleStartAt,
      scheduleEndAt,
      scheduleBeforeMessage: parsed.data.scheduleBeforeMessage || null,
      scheduleAfterMessage: parsed.data.scheduleAfterMessage || null,
      scheduleRedirectUrl: parsed.data.scheduleRedirectUrl || null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { field: "schedule" },
  });

  revalidatePath(`/apps/${campaignId}/agenda`);
}
