import type { CampaignForEditor } from "@/features/campaigns/queries";

/**
 * Heurística simples de etapas incompletas para o indicador visual do editor
 * (secção 7: "indicação de etapas incompletas"). Não bloqueia a navegação —
 * apenas sinaliza o que falta preencher antes de publicar.
 */
export function getIncompleteSteps(campaign: CampaignForEditor): Set<string> {
  const incomplete = new Set<string>();

  if (!campaign.startTitle) incomplete.add("ecra-inicial");

  const formPosition = campaign.leadForm?.position ?? "NONE";
  if (formPosition !== "NONE" && (campaign.leadForm?.fields.length ?? 0) === 0) {
    incomplete.add("formulario");
  }

  const gameConfigured =
    (campaign.type === "MEMORY" && (campaign.memoryConfig?.pairs.length ?? 0) > 0) ||
    (campaign.type === "WHEEL" && (campaign.wheelConfig?.segments.length ?? 0) > 0) ||
    (campaign.type === "QUIZ" && (campaign.quizConfig?.questions.length ?? 0) > 0);
  if (!gameConfigured) incomplete.add("jogo");

  if (!campaign.finalTitle) incomplete.add("ecra-final");

  return incomplete;
}
