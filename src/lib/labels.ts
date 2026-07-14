import type { CampaignStatus, CampaignType } from "@/generated/prisma/client";

export const CAMPAIGN_TYPE_LABELS: Record<CampaignType, string> = {
  MEMORY: "Jogo da Memória",
  WHEEL: "Roda da Sorte",
  QUIZ: "Quiz Interativo",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Rascunho",
  IN_REVIEW: "Em validação",
  SCHEDULED: "Agendado",
  PUBLISHED: "Publicado",
  PAUSED: "Pausado",
  EXPIRED: "Expirado",
  ARCHIVED: "Arquivado",
};

export const CAMPAIGN_STATUS_TONE: Record<
  CampaignStatus,
  "neutral" | "success" | "warning" | "info" | "danger"
> = {
  DRAFT: "neutral",
  IN_REVIEW: "info",
  SCHEDULED: "info",
  PUBLISHED: "success",
  PAUSED: "warning",
  EXPIRED: "danger",
  ARCHIVED: "neutral",
};
