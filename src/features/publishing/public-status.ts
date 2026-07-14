import type { Campaign } from "@/generated/prisma/client";

export type EffectivePublicState =
  | "unavailable"
  | "before_schedule"
  | "paused"
  | "expired"
  | "active";

/**
 * O estado "vivo" que o visitante vê, considerando a agenda mesmo que o campo
 * `status` na base de dados ainda não tenha sido atualizado por uma tarefa
 * periódica (essa tarefa fica para uma iteração futura — ver README).
 */
export function getEffectivePublicState(
  campaign: Pick<Campaign, "status" | "scheduleStartAt" | "scheduleEndAt">,
  now: Date = new Date(),
): EffectivePublicState {
  if (campaign.status === "DRAFT" || campaign.status === "IN_REVIEW" || campaign.status === "ARCHIVED") {
    return "unavailable";
  }
  if (campaign.status === "PAUSED") return "paused";
  if (campaign.status === "EXPIRED") return "expired";

  if (campaign.scheduleStartAt && now < campaign.scheduleStartAt) return "before_schedule";
  if (campaign.scheduleEndAt && now > campaign.scheduleEndAt) return "expired";

  return "active";
}
