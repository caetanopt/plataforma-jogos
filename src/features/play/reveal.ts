import type { LeadFormPosition } from "@/generated/prisma/client";

/**
 * Que parte do resultado pode chegar ao browser, dada a posição do
 * formulário de leads e se ele já foi submetido (secção 11).
 *
 * O resultado é sempre calculado no servidor (na roda com "antes do
 * resultado", só depois do formulário); o que muda é o que se devolve e
 * quando. Antes, o browser recebia sempre o
 * resultado completo e era o próprio browser que decidia quando mostrá-lo —
 * nas posições "antes do resultado" e "antes do prémio", o prémio chegava
 * antes do formulário e bastava ler a resposta da rede.
 */
export type RevealPolicy = "full" | "withhold_result" | "withhold_prize";

export function revealPolicy(position: LeadFormPosition | null, leadSubmitted: boolean): RevealPolicy {
  if (leadSubmitted) return "full";
  if (position === "BEFORE_RESULT") return "withhold_result";
  if (position === "BEFORE_PRIZE") return "withhold_prize";
  return "full";
}

/** Com o formulário antes do jogo, não se joga sem o submeter. */
export function leadMissingBeforePlay(position: LeadFormPosition | null, leadSubmitted: boolean): boolean {
  return position === "BEFORE_GAME" && !leadSubmitted;
}

interface WheelPrize {
  publicName: string;
  instructions: string | null;
  code: string | null;
}

interface WheelOutcome {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: WheelPrize | null;
}

/**
 * Com "antes de revelar o prémio", o browser fica a saber se ganhou (a roda
 * pára no segmento), mas o nome, as instruções e o código do prémio só
 * seguem depois do formulário. `prizePending` diz ao ecrã que há um prémio à
 * espera, sem dizer qual.
 */
export function projectWheelOutcome(
  result: WheelOutcome,
  policy: Exclude<RevealPolicy, "withhold_result">,
): WheelOutcome & { prizePending: boolean } {
  const base = {
    segmentId: result.segmentId,
    segmentName: result.segmentName,
    outcome: result.outcome,
    message: result.message,
  };
  if (policy === "withhold_prize") {
    return { ...base, prize: null, prizePending: result.prize !== null };
  }
  return {
    ...base,
    prize: result.prize
      ? { publicName: result.prize.publicName, instructions: result.prize.instructions, code: result.prize.code }
      : null,
    prizePending: false,
  };
}
