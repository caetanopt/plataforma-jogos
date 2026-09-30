/**
 * Relógio do servidor para a memória e o quiz (secções 12 e 14).
 *
 * O tempo de jogo vinha só do browser: bastava recarregar a página a meio
 * para o cronómetro voltar a zero e anular o tempo limite, o bónus de
 * rapidez e o desempate do ranking. O servidor regista quando o jogo abriu
 * (GameSession, por participação, nunca reescrito) e usa o maior dos dois
 * valores, com uma margem para a latência, as animações e a pré-visualização
 * das cartas — um jogador honesto não é penalizado.
 *
 * Não trava um pedido forjado: é o browser que diz quando o jogo abriu
 * (beginGameAction), e um script pode adiá-lo. Na memória o resultado inteiro
 * (pares, tentativas) vem do browser; nenhum destes jogos tem prémios.
 */

/** Latência e animações que o cronómetro do browser não conta. */
export const CLOCK_GRACE_SECONDS = 10;

/** Limite superior aceite pelas ações (igual à validação dos pedidos). */
const MAX_SECONDS = 86_400;

export function effectiveGameSeconds(input: {
  clientSeconds: number;
  /** Início do jogo no servidor (GameSession); sem ele, vale o do browser. */
  startedAt: Date | null;
  now: Date;
  /** Tempo que o browser exclui de propósito (pré-visualização da memória). */
  extraGraceSeconds?: number;
}): number {
  const client = Math.max(0, Math.floor(input.clientSeconds) || 0);
  if (!input.startedAt) return Math.min(client, MAX_SECONDS);
  const elapsed = (input.now.getTime() - input.startedAt.getTime()) / 1000;
  const floor = Math.floor(elapsed - CLOCK_GRACE_SECONDS - (input.extraGraceSeconds ?? 0));
  return Math.min(Math.max(client, floor), MAX_SECONDS);
}
