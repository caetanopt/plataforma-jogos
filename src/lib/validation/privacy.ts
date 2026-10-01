import { z } from "zod";
import { RETENTION_DAY_OPTIONS } from "@/features/privacy/retention-policy";
import { isPlausiblePhone, normalizeEmail, normalizePhone, phoneMatchForms } from "@/features/play/identity";
import type { SubjectIdentifier } from "@/features/leads/queries";

const DAY_VALUES = RETENTION_DAY_OPTIONS.map(String) as [string, ...string[]];

/** Prazo da organização: vazio (sem prazo) ou um dos prazos sugeridos (§24). */
export const organizationRetentionSchema = z
  .enum(["", ...DAY_VALUES], { error: "Prazo de conservação: opção inválida." })
  .transform((value) => (value === "" ? null : Number(value)));

/**
 * Prazo de uma campanha: o da organização, um dos prazos sugeridos, ou uma
 * data ("AAAA-MM-DD") a partir da qual tudo é anonimizado.
 */
export const campaignRetentionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("inherit") }),
  z.object({ mode: z.literal("days"), days: z.enum(DAY_VALUES).transform(Number) }),
  z.object({
    mode: z.literal("until"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de anonimização: escolha uma data."),
  }),
]);

export type CampaignRetentionInput = z.infer<typeof campaignRetentionSchema>;

/** O valor do seletor do editor ("inherit", "30", …, "until") no formato do schema. */
export function campaignRetentionFromForm(value: string, date: string): unknown {
  if (value === "inherit") return { mode: "inherit" };
  if (value === "until") return { mode: "until", date };
  return { mode: "days", days: value };
}

/** Anonimização manual: as selecionadas na lista ou tudo o que os filtros mostram. */
export const ANONYMIZE_SELECTION_MAX = 500;
export const anonymizeSelectionSchema = z
  .array(z.string().min(1).max(64))
  .min(1, "Selecione pelo menos uma lead.")
  .max(ANONYMIZE_SELECTION_MAX, `No máximo ${ANONYMIZE_SELECTION_MAX} leads de cada vez.`);

/**
 * O e-mail ou o telefone de um pedido de um titular, normalizados como estão
 * gravados nas participações; o telefone com as formas equivalentes (com e
 * sem o +351, ver phoneMatchForms). Null: nem um e-mail nem um telefone
 * completo.
 */
export function parseSubjectIdentifier(value: string): SubjectIdentifier | null {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    return email && z.email().safeParse(email).success ? { kind: "email", email } : null;
  }
  if (!isPlausiblePhone(trimmed)) return null;
  const phone = normalizePhone(trimmed)!;
  return { kind: "phone", phone, forms: phoneMatchForms(phone) };
}
