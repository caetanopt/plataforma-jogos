import { z } from "zod";
import {
  checkboxField,
  dateTimeLocalField,
  httpUrlField,
  mediaIdField,
  optionalIntField,
  requiredTextField,
  textField,
} from "@/lib/validation/fields";

export const campaignTypeSchema = z.enum(["MEMORY", "WHEEL", "QUIZ"]);

export const createCampaignSchema = z.object({
  type: campaignTypeSchema,
  workspaceId: z.string().min(1),
  folderId: z.string().min(1).optional(),
});

/*
 * Etapas do editor com gravação automática. Cada uma exporta a forma
 * (validada campo a campo por `parsePartial`) e os limites, que os inputs
 * usam em `maxLength`: o browser não deixa escrever mais do que o servidor
 * aceita.
 */

export const PROJECT_INFO_LIMITS = {
  internalName: 150,
  publicTitle: 150,
  internalReference: 100,
  tags: 300,
  description: 2000,
  slug: 80,
} as const;

/**
 * Fuso horário IANA que o `Intl` conhece. As datas da agenda convertem-se
 * com ele (`zonedDateTimeToUtc`): um nome inválido fazia rebentar a
 * conversão, e com ela a gravação da agenda e o jogo público.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const projectInfoShape = {
  internalName: requiredTextField("Nome interno", PROJECT_INFO_LIMITS.internalName),
  publicTitle: textField("Título público", PROJECT_INFO_LIMITS.publicTitle),
  internalReference: textField("Referência interna", PROJECT_INFO_LIMITS.internalReference),
  workspaceId: z
    .string()
    .trim()
    .min(1, "Espaço de trabalho: obrigatório.")
    .max(60, "Espaço de trabalho: inválido."),
  folderId: z.string().trim().max(60, "Pasta: inválida."),
  tags: textField("Etiquetas", PROJECT_INFO_LIMITS.tags),
  description: textField("Descrição", PROJECT_INFO_LIMITS.description),
  locale: z.string().trim().min(2, "Idioma: inválido.").max(10, "Idioma: inválido."),
  timezone: z
    .string()
    .trim()
    .min(1, "Fuso horário: obrigatório.")
    .max(60, "Fuso horário: inválido.")
    .refine(isValidTimeZone, "Fuso horário: inválido."),
  // Pode ter mais do que os 60 do `slugify`: os gerados levam um sufixo.
  slug: textField("Endereço público", PROJECT_INFO_LIMITS.slug),
};

/** Regras da etapa Informações que dependem da base de dados (servidor e teste). */
export const PROJECT_INFO_MESSAGES = {
  slugLocked: "O endereço público não pode mudar depois de publicar.",
  slugTaken: "Este endereço já está a ser usado por outra campanha.",
  slugEmpty: "Endereço público: use pelo menos uma letra ou um número.",
  workspaceNotFound: "Espaço de trabalho: não encontrado. Recarregue a página.",
  folderOutsideWorkspace: "A pasta não pertence ao espaço de trabalho escolhido; a aplicação ficou sem pasta.",
} as const;

export const START_SCREEN_LIMITS = {
  startTitle: 200,
  startSubtitle: 200,
  startIntroText: 2000,
  startButtonLabel: 60,
  startPrizeInfo: 500,
  // Um regulamento real passa facilmente os 5000 caracteres antigos.
  regulationText: 20000,
  legalText: 2000,
} as const;

export const startScreenShape = {
  startTitle: textField("Título", START_SCREEN_LIMITS.startTitle),
  startSubtitle: textField("Subtítulo", START_SCREEN_LIMITS.startSubtitle),
  startIntroText: textField("Texto introdutório", START_SCREEN_LIMITS.startIntroText),
  startMediaId: mediaIdField,
  startLogoMediaId: mediaIdField,
  startButtonLabel: textField("Texto do botão", START_SCREEN_LIMITS.startButtonLabel),
  startPrizeInfo: textField("Informação sobre o prémio", START_SCREEN_LIMITS.startPrizeInfo),
  countdownEnabled: checkboxField,
  regulationText: textField("Regulamento", START_SCREEN_LIMITS.regulationText),
  legalText: textField("Texto legal", START_SCREEN_LIMITS.legalText),
};

export const screenKindSchema = z.enum(["INTERMEDIATE_BEFORE", "INTERMEDIATE_AFTER"]);

export const SCREEN_LIMITS = {
  title: 200,
  text: 2000,
  ctaLabel: 60,
  ctaUrl: 500,
  continueButtonLabel: 60,
} as const;

export const intermediateScreenShape = {
  // Só mostra ou esconde o ecrã: o conteúdo fica gravado nos dois casos.
  enabled: checkboxField,
  title: textField("Título", SCREEN_LIMITS.title),
  text: textField("Texto", SCREEN_LIMITS.text),
  mediaId: mediaIdField,
  ctaLabel: textField("Texto do botão de ação", SCREEN_LIMITS.ctaLabel),
  ctaUrl: httpUrlField("Link do botão de ação", SCREEN_LIMITS.ctaUrl),
  continueButtonLabel: textField("Texto do botão continuar", SCREEN_LIMITS.continueButtonLabel),
};

export const FINAL_SCREEN_LIMITS = {
  finalTitle: 200,
  finalMessage: 2000,
  finalCtaLabel: 60,
  finalCtaUrl: 500,
} as const;

export const finalScreenShape = {
  finalTitle: textField("Título", FINAL_SCREEN_LIMITS.finalTitle),
  finalMessage: textField("Mensagem", FINAL_SCREEN_LIMITS.finalMessage),
  finalMediaId: mediaIdField,
  finalCtaLabel: textField("Texto do botão de ação", FINAL_SCREEN_LIMITS.finalCtaLabel),
  finalCtaUrl: httpUrlField("Link do botão de ação", FINAL_SCREEN_LIMITS.finalCtaUrl),
  finalAllowReplay: checkboxField,
  finalAllowShare: checkboxField,
};

export const participationLimitTypeSchema = z.enum([
  "UNLIMITED",
  "ONE_TOTAL",
  "ONE_PER_DAY",
  "ONE_PER_HOUR",
  "CUSTOM_MAX",
]);

export const PARTICIPATION_LIMITS = {
  customMaxMin: 1,
  customMaxMax: 1_000_000,
  minAgeMin: 1,
  minAgeMax: 120,
} as const;

export const participationRulesShape = {
  participationLimitType: z.enum(participationLimitTypeSchema.options, {
    error: "Limite de participação: opção inválida.",
  }),
  participationCustomMax: optionalIntField(
    "Máximo de participações",
    PARTICIPATION_LIMITS.customMaxMin,
    PARTICIPATION_LIMITS.customMaxMax,
  ),
  minAge: optionalIntField("Idade mínima", PARTICIPATION_LIMITS.minAgeMin, PARTICIPATION_LIMITS.minAgeMax),
};

/** Regra entre campos da etapa Regras (usada no servidor e no teste). */
export const PARTICIPATION_CUSTOM_MAX_REQUIRED_MESSAGE =
  "Máximo de participações: obrigatório com «Máximo personalizado».";

export const SCHEDULE_LIMITS = { message: 500, redirectUrl: 500 } as const;

export const scheduleShape = {
  scheduleStartAt: dateTimeLocalField("Início"),
  scheduleEndAt: dateTimeLocalField("Fim"),
  scheduleBeforeMessage: textField("Mensagem antes do início", SCHEDULE_LIMITS.message),
  scheduleAfterMessage: textField("Mensagem depois do fim", SCHEDULE_LIMITS.message),
  scheduleRedirectUrl: httpUrlField("Redirecionamento", SCHEDULE_LIMITS.redirectUrl),
};

/** Mensagem da regra entre as duas datas (usada no servidor e no teste). */
export const SCHEDULE_ORDER_MESSAGE = "Fim: tem de ser depois do início.";

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
