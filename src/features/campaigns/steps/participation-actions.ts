"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { participationRulesSchema } from "@/lib/validation/campaign";
import { getField } from "@/lib/forms/form-data";

export async function updateParticipationRulesAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = participationRulesSchema.safeParse({
    participationLimitType: getField(formData, "participationLimitType"),
    participationCustomMax: getField(formData, "participationCustomMax"),
    minAge: getField(formData, "minAge"),
  });
  if (!parsed.success) return;

  const customMax =
    parsed.data.participationLimitType === "CUSTOM_MAX" && parsed.data.participationCustomMax
      ? Number.parseInt(parsed.data.participationCustomMax, 10)
      : null;
  const minAge = parsed.data.minAge ? Number.parseInt(parsed.data.minAge, 10) : null;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      participationLimitType: parsed.data.participationLimitType,
      participationCustomMax: customMax,
      minAge,
    },
  });

  // Regras de elegibilidade têm impacto direto no controlo de fraude
  // (secção 16) — auditar com antes/depois, como as alterações a
  // probabilidades/stock da Roda.
  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: {
      step: "regras",
      participationLimitTypeBefore: campaign.participationLimitType,
      participationLimitTypeAfter: parsed.data.participationLimitType,
      participationCustomMaxBefore: campaign.participationCustomMax,
      participationCustomMaxAfter: customMax,
      minAgeBefore: campaign.minAge,
      minAgeAfter: minAge,
    },
  });

  revalidatePath(`/apps/${campaignId}/regras`);
}
