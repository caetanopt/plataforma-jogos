import type { CampaignStatus, LeadFormPosition } from "@/generated/prisma/client";
import type { CampaignForEditor } from "@/features/campaigns/queries";
import { isLiveStatus } from "@/features/campaigns/live-status";
import { AGE_UNVERIFIABLE_ISSUE, isAgeVerifiable } from "@/features/publishing/age-check";
import { effectiveLeadFormPosition, visibleFieldCount } from "@/features/play/reveal";
import { readLegalLinks } from "@/features/brand/legal-links";

export interface PublishReadiness {
  ready: boolean;
  issues: string[];
}

export const PRIVACY_NOTICE_ISSUE =
  "O formulário de leads recolhe dados pessoais: indique o texto legal (Ecrã inicial) ou o link da política de privacidade (Marca e design).";

/** O que decide se o jogo tem de mostrar um aviso de privacidade. */
export interface PrivacyNoticeInput {
  legalText: string | null;
  theme: { legalLinks: unknown } | null;
  leadForm: {
    position: LeadFormPosition;
    fields: readonly { type: string }[];
    consentDefinitions: readonly unknown[];
  } | null;
}

/**
 * Um formulário que pede dados pessoais tem de dizer como são tratados
 * (art. 13.º do RGPD, §24): pelo texto legal ou pela política de
 * privacidade. Antes publicava-se sem nada, e o jogo recolhia nome, e-mail e
 * telefone sem aviso. Pede dados um formulário que entra no fluxo: com
 * campos visíveis ou com consentimentos (que também têm de ser informados).
 * Vazio, "Sem formulário" ou só com campos ocultos, não pede nada.
 */
export function hasPrivacyNotice(campaign: PrivacyNoticeInput): boolean {
  const form = campaign.leadForm;
  if (!form) return true;
  const position = effectiveLeadFormPosition({
    position: form.position,
    fieldCount: visibleFieldCount(form.fields),
    consentCount: form.consentDefinitions.length,
  });
  if (position === "NONE") return true;
  return Boolean(campaign.legalText?.trim()) || readLegalLinks(campaign.theme?.legalLinks).privacyPolicyUrl !== null;
}

/**
 * Numa campanha publicada, uma edição que tira o aviso a um formulário que
 * pede dados (ou que passa a pedir dados sem aviso). A publicação já o
 * recusava, mas depois de publicar o editor deixava-o fazer: o jogo passava
 * a recolher e-mails sem aviso nenhum. Uma campanha que já estava assim não
 * fica pior; o editor avisa-a à parte.
 */
export function editRemovesLivePrivacyNotice(
  status: CampaignStatus,
  before: PrivacyNoticeInput,
  after: PrivacyNoticeInput,
): boolean {
  return isLiveStatus(status) && hasPrivacyNotice(before) && !hasPrivacyNotice(after);
}

export const LIVE_PRIVACY_NOTICE_MESSAGE =
  "A campanha está publicada e o formulário de leads pede dados pessoais: é preciso manter o texto legal (Ecrã inicial) ou o link da política de privacidade (Marca e design).";

/** Campanha publicada antes da regra, que já recolhe dados sem aviso. */
export const LIVE_PRIVACY_NOTICE_MISSING_WARNING =
  "Esta campanha está publicada e o formulário de leads recolhe dados pessoais sem aviso de privacidade. Indique o texto legal (Ecrã inicial) ou o link da política de privacidade (Marca e design).";

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
