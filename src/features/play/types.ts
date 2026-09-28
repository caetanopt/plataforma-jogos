/**
 * Contratos entre o jogo público (browser) e as server actions de
 * participação. Só tipos: é importado pelos componentes cliente.
 */

/**
 * Prova de posse de uma participação.
 *
 * Todas as ações depois do início exigem o id E o token. O token é a chave
 * de idempotência que o browser gerou ao iniciar (`crypto.randomUUID()`):
 * nunca sai do browser de quem joga nem aparece no backoffice, por isso
 * saber o id de uma participação alheia não chega para a jogar, lhe
 * associar uma lead ou ver o resultado.
 */
export interface ParticipationRef {
  participationId: string;
  token: string;
}

export type GameBlockedReason =
  /** Participação inexistente ou token errado. */
  | "not_found"
  /** A campanha deixou de aceitar participações (pausada, expirada, fora da agenda). */
  | "not_active"
  /** O formulário é pedido antes do jogo e ainda não foi submetido. */
  | "lead_missing";

/**
 * Resposta de uma ação de jogo (rodar, terminar a memória, submeter o quiz).
 *
 * `lead_required` significa que o resultado só é revelado depois do
 * formulário (posição "Antes de revelar o resultado"). Na memória e no quiz
 * a pontuação já fica gravada; na roda nem se sorteia antes do formulário,
 * para não prender um prémio a uma lead que pode ser recusada. Repetir a
 * mesma ação depois de submeter o formulário devolve o resultado — as ações
 * são idempotentes.
 */
export type GameActionResponse<T> =
  | { status: "revealed"; result: T }
  | { status: "lead_required" }
  | { status: "blocked"; reason: GameBlockedReason };
