import { prisma } from "@/server/db/client";
import type { PrivacyNoticeInput } from "@/features/publishing/readiness";

/**
 * O estado de que depende o aviso de privacidade de uma campanha (ver
 * `editRemovesLivePrivacyNotice`), para as ações do editor compararem o
 * antes e o depois de uma edição.
 */
export async function loadPrivacyNoticeState(campaignId: string) {
  const campaign = await prisma.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      status: true,
      legalText: true,
      theme: { select: { legalLinks: true } },
      leadForm: {
        select: {
          position: true,
          fields: { select: { type: true } },
          consentDefinitions: { select: { id: true } },
        },
      },
    },
  });
  const state: PrivacyNoticeInput = {
    legalText: campaign.legalText,
    theme: campaign.theme,
    leadForm: campaign.leadForm,
  };
  return { status: campaign.status, state };
}
