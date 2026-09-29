import type { CampaignForEditor } from "@/features/campaigns/queries";
import { effectiveLeadFormPosition } from "@/features/play/reveal";

export interface PublishReadiness {
  ready: boolean;
  issues: string[];
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

  // A idade mínima só se verifica com a data de nascimento no formulário;
  // sem ela o jogo público recusa todas as participações (falha fechado).
  const position = effectiveLeadFormPosition(
    campaign.leadForm
      ? {
          position: campaign.leadForm.position,
          fieldCount: campaign.leadForm.fields.length,
          consentCount: campaign.leadForm.consentDefinitions.length,
        }
      : null,
  );
  const hasBirthDate = campaign.leadForm?.fields.some((field) => field.type === "BIRTH_DATE") ?? false;
  if (campaign.minAge != null && (position === "NONE" || !hasBirthDate)) {
    issues.push("A idade mínima exige um campo de data de nascimento no formulário de leads.");
  }

  return { ready: issues.length === 0, issues };
}
