import type { CampaignForEditor } from "@/features/campaigns/queries";
import { AGE_UNVERIFIABLE_ISSUE, isAgeVerifiable } from "@/features/publishing/age-check";
import { effectiveLeadFormPosition } from "@/features/play/reveal";
import { readLegalLinks } from "@/features/brand/legal-links";

export interface PublishReadiness {
  ready: boolean;
  issues: string[];
}

export const PRIVACY_NOTICE_ISSUE =
  "O formulário de leads recolhe dados pessoais: indique o texto legal (Ecrã inicial) ou o link da política de privacidade (Marca e design).";

/**
 * Um formulário que pede dados pessoais tem de dizer como são tratados
 * (art. 13.º do RGPD, §24): pelo texto legal ou pela política de
 * privacidade. Antes publicava-se sem nada, e o jogo recolhia nome, e-mail e
 * telefone sem aviso. Um formulário que não entra no fluxo (vazio ou "Sem
 * formulário") ou só com campos ocultos não pede nada ao participante.
 */
export function hasPrivacyNotice(
  campaign: Pick<CampaignForEditor, "legalText" | "leadForm"> & { theme: { legalLinks: unknown } | null },
): boolean {
  const form = campaign.leadForm;
  if (!form) return true;
  const position = effectiveLeadFormPosition({
    position: form.position,
    fieldCount: form.fields.length,
    consentCount: form.consentDefinitions.length,
  });
  const asksPersonalData = position !== "NONE" && form.fields.some((field) => field.type !== "HIDDEN");
  if (!asksPersonalData) return true;
  return Boolean(campaign.legalText?.trim()) || readLegalLinks(campaign.theme?.legalLinks).privacyPolicyUrl !== null;
}

export function getPublishReadiness(campaign: CampaignForEditor): PublishReadiness {
  const issues: string[] = [];

  if (campaign.type === "MEMORY") {
    const pairs = campaign.memoryConfig?.pairs ?? [];
    if (pairs.length < 2) {
      issues.push("O Jogo da Memória precisa de pelo menos 2 pares de cartas.");
    }
  }

  if (campaign.type === "WHEEL") {
    const segments = campaign.wheelConfig?.segments ?? [];
    const activeWeight = segments.filter((s) => s.isActive).reduce((sum, s) => sum + s.weight, 0);
    if (activeWeight <= 0) {
      issues.push("A Roda da Sorte precisa de pelo menos um segmento ativo com peso superior a 0.");
    }
  }

  if (campaign.type === "QUIZ") {
    const questions = campaign.quizConfig?.questions ?? [];
    if (questions.length === 0) {
      issues.push("O Quiz precisa de pelo menos uma pergunta.");
    }
    const questionsWithoutCorrectAnswer = questions.filter(
      (q) => !q.answers.some((a) => a.isCorrect),
    );
    if (questionsWithoutCorrectAnswer.length > 0) {
      issues.push("Todas as perguntas do Quiz precisam de ter pelo menos uma resposta correta.");
    }
    // O jogo só deixa escolher uma resposta nestes tipos: com duas certas, a
    // pergunta não pode ser acertada.
    const singleAnswerWithSeveralCorrect = questions.filter(
      (q) => q.type !== "MULTIPLE_CHOICE" && q.answers.filter((a) => a.isCorrect).length > 1,
    );
    if (singleAnswerWithSeveralCorrect.length > 0) {
      issues.push("As perguntas de resposta única só podem ter uma resposta correta.");
    }
  }

  if (!campaign.leadForm) {
    issues.push("A campanha precisa de ter um formulário de leads configurado.");
  }

  const ageForm = campaign.leadForm
    ? {
        position: campaign.leadForm.position,
        fields: campaign.leadForm.fields,
        consentCount: campaign.leadForm.consentDefinitions.length,
      }
    : null;
  if (!isAgeVerifiable(campaign.minAge, ageForm)) {
    issues.push(AGE_UNVERIFIABLE_ISSUE);
  }

  if (!hasPrivacyNotice(campaign)) {
    issues.push(PRIVACY_NOTICE_ISSUE);
  }

  return { ready: issues.length === 0, issues };
}
