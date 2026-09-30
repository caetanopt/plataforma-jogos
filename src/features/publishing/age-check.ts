import type { CampaignStatus, LeadFieldType, LeadFormPosition } from "@/generated/prisma/client";
import { effectiveLeadFormPosition } from "@/features/play/reveal";
import { isLiveStatus } from "@/features/campaigns/live-status";

export interface AgeCheckForm {
  position: LeadFormPosition;
  fields: readonly { type: LeadFieldType }[];
  consentCount: number;
}

/**
 * A idade mínima só se verifica com a data de nascimento num formulário que
 * entra no fluxo. Sem isso o jogo público recusa todas as participações
 * (falha fechado, §16), por isso a mesma regra decide a publicação, o jogo e
 * o que o editor deixa mudar numa campanha já publicada.
 */
export function isAgeVerifiable(minAge: number | null, form: AgeCheckForm | null): boolean {
  if (minAge == null) return true;
  if (!form) return false;
  const position = effectiveLeadFormPosition({
    position: form.position,
    fieldCount: form.fields.length,
    consentCount: form.consentCount,
  });
  return position !== "NONE" && form.fields.some((field) => field.type === "BIRTH_DATE");
}

/**
 * Uma edição que fecharia uma campanha publicada a todos os visitantes: a
 * idade verificava-se antes e deixa de se verificar. O editor recusa-a e diz
 * porquê; antes gravava, dizia "Alterações guardadas" e a campanha parava.
 * Uma campanha que já estava nesse estado (publicada antes da regra) não
 * fica pior com a edição, e a etapa Regras avisa-a à parte.
 */
export function editBreaksLiveAgeCheck(
  status: CampaignStatus,
  before: { minAge: number | null; form: AgeCheckForm | null },
  after: { minAge: number | null; form: AgeCheckForm | null },
): boolean {
  return (
    isLiveStatus(status) &&
    isAgeVerifiable(before.minAge, before.form) &&
    !isAgeVerifiable(after.minAge, after.form)
  );
}

export const AGE_UNVERIFIABLE_ISSUE = "A idade mínima exige um campo de data de nascimento no formulário de leads.";

export const LIVE_MIN_AGE_NEEDS_BIRTH_DATE_MESSAGE =
  "Idade mínima: a campanha está publicada e o formulário de leads não tem data de nascimento (ou está em «Sem formulário»). Com idade mínima, deixaria de aceitar participações. Adicione primeiro o campo «Data de nascimento».";
export const LIVE_POSITION_NEEDS_FORM_MESSAGE =
  "Posição: a campanha está publicada e tem idade mínima, que só se verifica no formulário. Sem formulário, deixaria de aceitar participações. Retire primeiro a idade mínima em Regras.";
export const LIVE_BIRTH_DATE_REQUIRED_MESSAGE =
  "Este campo não pode ser removido: a campanha está publicada e tem idade mínima, que só se verifica com a data de nascimento. Sem ele, deixaria de aceitar participações. Retire primeiro a idade mínima em Regras.";
export const LIVE_AGE_BLOCKED_WARNING =
  "Esta campanha está publicada mas não aceita participações: tem idade mínima e o formulário de leads não tem data de nascimento (ou está em «Sem formulário»). Adicione o campo «Data de nascimento» ou retire a idade mínima.";
