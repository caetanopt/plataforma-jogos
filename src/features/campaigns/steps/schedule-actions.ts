"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { scheduleSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";
import { zonedDateTimeToUtc } from "@/lib/dates/timezone";
import { isLiveStatus } from "@/features/campaigns/live-status";

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

  // Numa campanha que já está no ar, as datas decidem se ela aceita
  // participações (getEffectivePublicState lê-as em direto): empurrar o fim
  // reabre uma campanha expirada, puxar o início abre uma agendada. Isso é
  // publicar ou despublicar, e exige a mesma permissão. Sem ela, as datas
  // ficam como estão e só as mensagens são gravadas (a página desativa os
  // campos das datas nesse caso).
  const mayChangeDates = !isLiveStatus(campaign.status) || can(context, "campaign:publish");

  // A hora vem do <input type="datetime-local"> como hora "de parede", sem
  // fuso — tem de ser interpretada no fuso da campanha, não no fuso do
  // processo do servidor (new Date(str) usaria este último).
  const scheduleStartAt = !mayChangeDates
    ? campaign.scheduleStartAt
    : parsed.data.scheduleStartAt
      ? zonedDateTimeToUtc(parsed.data.scheduleStartAt, campaign.timezone)
      : null;
  const scheduleEndAt = !mayChangeDates
    ? campaign.scheduleEndAt
    : parsed.data.scheduleEndAt
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
    metadata: {
      field: "schedule",
      // Datas antes/depois: são elas que abrem e fecham a campanha (§26).
      startBefore: campaign.scheduleStartAt?.toISOString() ?? null,
      startAfter: scheduleStartAt?.toISOString() ?? null,
      endBefore: campaign.scheduleEndAt?.toISOString() ?? null,
      endAfter: scheduleEndAt?.toISOString() ?? null,
    },
  });

  revalidatePath(`/apps/${campaignId}/agenda`);
}
