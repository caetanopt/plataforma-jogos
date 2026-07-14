import type { CampaignForEditor } from "@/features/campaigns/queries";

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
  }

  if (!campaign.leadForm) {
    issues.push("A campanha precisa de ter um formulário de leads configurado.");
  }

  return { ready: issues.length === 0, issues };
}
