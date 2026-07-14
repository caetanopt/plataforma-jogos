import type {
  CampaignStatus,
  CampaignType,
  DedupStrategy,
  LeadFieldType,
  LeadFormPosition,
  ParticipationLimitType,
} from "@/generated/prisma/client";

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

export const LEAD_FIELD_TYPE_LABELS: Record<LeadFieldType, string> = {
  FIRST_NAME: "Nome",
  LAST_NAME: "Apelido",
  FULL_NAME: "Nome completo",
  EMAIL: "E-mail",
  PHONE: "Telefone",
  BIRTH_DATE: "Data de nascimento",
  POSTAL_CODE: "Código postal",
  CITY: "Localidade",
  COUNTRY: "País",
  COMPANY: "Empresa",
  JOB_TITLE: "Cargo",
  CUSTOMER_NUMBER: "Número de cliente",
  SINGLE_CHOICE: "Escolha única",
  MULTIPLE_CHOICE: "Escolha múltipla",
  SHORT_TEXT: "Texto curto",
  LONG_TEXT: "Texto longo",
  DROPDOWN: "Dropdown",
  DATE: "Data",
  CHECKBOX: "Checkbox",
  HIDDEN: "Campo oculto",
  CONSENT: "Consentimento",
  TERMS_ACCEPTANCE: "Aceitação de regulamento",
};

export const LEAD_FORM_POSITION_LABELS: Record<LeadFormPosition, string> = {
  BEFORE_GAME: "Antes do jogo",
  AFTER_GAME: "Depois do jogo",
  BEFORE_RESULT: "Antes de revelar o resultado",
  BEFORE_PRIZE: "Antes de revelar o prémio",
  NONE: "Sem formulário",
};

export const DEDUP_STRATEGY_LABELS: Record<DedupStrategy, string> = {
  EMAIL: "E-mail",
  PHONE: "Telefone",
  COOKIE: "Cookie",
  SESSION: "Sessão",
  IP: "IP (uso limitado)",
  CODE: "Código único",
  FIELD_COMBINATION: "Combinação de campos",
};

export const PARTICIPATION_LIMIT_TYPE_LABELS: Record<ParticipationLimitType, string> = {
  UNLIMITED: "Ilimitada",
  ONE_TOTAL: "Uma participação no total",
  ONE_PER_DAY: "Uma participação por dia",
  ONE_PER_HOUR: "Uma participação por hora",
  CUSTOM_MAX: "Máximo personalizado",
};
