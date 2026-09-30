import { z } from "zod";
import { checkboxField, requiredTextField, textField } from "@/lib/validation/fields";

export const leadFormPositionSchema = z.enum([
  "BEFORE_GAME",
  "AFTER_GAME",
  "BEFORE_RESULT",
  "BEFORE_PRIZE",
  "NONE",
]);

export const leadFieldTypeSchema = z.enum([
  "FIRST_NAME",
  "LAST_NAME",
  "FULL_NAME",
  "EMAIL",
  "PHONE",
  "BIRTH_DATE",
  "POSTAL_CODE",
  "CITY",
  "COUNTRY",
  "COMPANY",
  "JOB_TITLE",
  "CUSTOMER_NUMBER",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
  "LONG_TEXT",
  "DROPDOWN",
  "DATE",
  "CHECKBOX",
  "HIDDEN",
  "CONSENT",
  "TERMS_ACCEPTANCE",
]);

export const dedupStrategySchema = z.enum([
  "EMAIL",
  "PHONE",
  "COOKIE",
  "SESSION",
  "IP",
  "CODE",
  "FIELD_COMBINATION",
]);

/*
 * Etapa Formulário de leads. Os limites são os mesmos que os inputs usam em
 * `maxLength`: o browser não deixa escrever mais do que o servidor aceita.
 */

export const LEAD_FIELD_LIMITS = {
  label: 150,
  placeholder: 150,
  helpText: 300,
  options: 2000,
  exportMapping: 150,
  // Sem campo no editor: só se validam se vierem no envio.
  validationRegex: 300,
  defaultValue: 300,
} as const;

export const CONSENT_LIMITS = { text: 3000 } as const;

/**
 * Texto de uma `<textarea>`. O envio do formulário (multipart) troca cada
 * mudança de linha por CRLF, que contaria dois caracteres para o limite
 * quando o `maxLength` do browser conta um.
 */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function multilineField(field: z.ZodString) {
  return z.string().transform(normalizeNewlines).pipe(field);
}

/** Uma opção por linha; linhas em branco não contam. */
export function parseOptionLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Definições gerais (gravação automática, campo a campo). */
export const leadFormSettingsShape = {
  position: z.enum(leadFormPositionSchema.options, { error: "Posição do formulário: opção inválida." }),
  honeypotEnabled: checkboxField,
  dedupStrategies: z
    .array(z.enum(dedupStrategySchema.options, { error: "Controlo de duplicados: opção inválida." }))
    .transform((values) => [...new Set(values)]),
};

export const addLeadFieldSchema = z.object({
  type: z.enum(leadFieldTypeSchema.options, { error: "Tipo de campo: opção inválida." }),
  label: requiredTextField("Label", LEAD_FIELD_LIMITS.label),
});

/** Edição de um campo (gravação automática, campo a campo). */
export const leadFieldShape = {
  label: requiredTextField("Label", LEAD_FIELD_LIMITS.label),
  placeholder: textField("Placeholder", LEAD_FIELD_LIMITS.placeholder),
  helpText: textField("Texto de ajuda", LEAD_FIELD_LIMITS.helpText),
  required: checkboxField,
  validationRegex: textField("Expressão de validação", LEAD_FIELD_LIMITS.validationRegex),
  defaultValue: textField("Valor predefinido", LEAD_FIELD_LIMITS.defaultValue),
  options: multilineField(textField("Opções", LEAD_FIELD_LIMITS.options)).transform(parseOptionLines),
  exportMapping: textField("Mapeamento de exportação", LEAD_FIELD_LIMITS.exportMapping),
};

const CHOICE_FIELD_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"];

export function fieldTypeHasOptions(type: string): boolean {
  return CHOICE_FIELD_TYPES.includes(type);
}

/** Regra do RGPD entre as duas checkboxes (usada no servidor e no teste). */
export const CONSENT_MARKETING_REQUIRED_MESSAGE =
  "Um consentimento de marketing não pode ser obrigatório: tem de ser dado livremente (RGPD).";

/** Um consentimento já registado numa participação (ON DELETE RESTRICT). */
export const CONSENT_IN_USE_MESSAGE =
  "Este consentimento já foi aceite por participantes e não pode ser removido. Edite o texto para criar uma nova versão.";

/**
 * Consentimento completo (criar e editar). Na edição, as checkboxes que o
 * formulário não enviar entram com o valor gravado: a regra do marketing
 * vale sobre o resultado final, não só sobre o que mudou.
 */
export const consentSchema = z
  .object({
    text: multilineField(requiredTextField("Texto do consentimento", CONSENT_LIMITS.text)),
    isMarketing: checkboxField,
    required: checkboxField,
  })
  .superRefine((value, ctx) => {
    // §11/§24: o consentimento de marketing é livre; obrigatório, deixava
    // de o ser (quem não aceita não pode participar).
    if (value.isMarketing && value.required) {
      ctx.addIssue({ code: "custom", path: ["required"], message: CONSENT_MARKETING_REQUIRED_MESSAGE });
    }
  });

/**
 * O carácter de marketing de um consentimento já aceite não muda: o registo
 * de cada participante não guarda uma cópia dele, e a lista, o filtro e a
 * exportação de leads leem-no da definição. Um consentimento obrigatório
 * (aceite por todos) passava a "marketing concedido" de toda a gente.
 */
export const CONSENT_MARKETING_LOCKED_MESSAGE =
  "Este consentimento já foi aceite ou recusado por participantes: não pode passar a ser (ou deixar de ser) de marketing. Crie um consentimento novo.";
