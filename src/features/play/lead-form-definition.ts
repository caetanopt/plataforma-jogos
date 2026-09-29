import type { LeadFormPosition } from "@/generated/prisma/client";
import type { PublicLeadFormDefinition } from "@/features/play/types";

interface LeadFormWithContent {
  honeypotEnabled: boolean;
  fields: ReadonlyArray<{
    id: string;
    internalKey: string;
    type: string;
    label: string;
    placeholder: string | null;
    helpText: string | null;
    required: boolean;
    options: unknown;
    order: number;
  }>;
  consentDefinitions: ReadonlyArray<{ id: string; text: string; required: boolean; isMarketing: boolean; order: number }>;
}

/**
 * O que o browser precisa para mostrar o formulário, e nada mais: nem o
 * mapeamento de exportação, nem as expressões de validação, nem as versões
 * dos consentimentos.
 */
export function toPublicLeadForm(
  form: LeadFormWithContent | null | undefined,
  position: LeadFormPosition,
): PublicLeadFormDefinition | null {
  if (!form || position === "NONE") return null;
  return {
    position,
    honeypotEnabled: form.honeypotEnabled,
    fields: [...form.fields]
      .sort((a, b) => a.order - b.order)
      .map((field) => ({
        id: field.id,
        internalKey: field.internalKey,
        type: field.type,
        label: field.label,
        placeholder: field.placeholder,
        helpText: field.helpText,
        required: field.required,
        options: Array.isArray(field.options) ? field.options.filter((o): o is string => typeof o === "string") : null,
      })),
    consents: [...form.consentDefinitions]
      .sort((a, b) => a.order - b.order)
      // Um consentimento de marketing nunca é obrigatório (§11, §24). O editor
      // já o recusa; isto cobre os gravados antes dessa regra.
      .map((consent) => ({ id: consent.id, text: consent.text, required: consent.required && !consent.isMarketing })),
  };
}
