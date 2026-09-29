import type { CampaignStatus } from "@/generated/prisma/client";

/**
 * Estados em que a campanha foi publicada: as datas da agenda decidem se ela
 * aceita participações, por isso mudá-las equivale a publicar ou despublicar.
 */
const LIVE_STATUSES: readonly CampaignStatus[] = ["PUBLISHED", "SCHEDULED", "PAUSED", "EXPIRED"];

export function isLiveStatus(status: CampaignStatus): boolean {
  return LIVE_STATUSES.includes(status);
}
