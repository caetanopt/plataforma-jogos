export interface MemoryScoringConfig {
  pointsPerPair: number;
  penaltyPerMistake: number;
  speedBonusEnabled: boolean;
  timeLimitSeconds: number | null;
  maxAttempts: number | null;
}

export interface MemoryScoringInput {
  pairsTotal: number;
  pairsFound: number;
  attempts: number;
  timeSeconds: number;
  config: MemoryScoringConfig;
}

export interface MemoryScoringResult {
  score: number;
  completed: boolean;
  withinTimeLimit: boolean;
  withinAttemptLimit: boolean;
  /** Valores depois de sanitizados — usar estes para persistir, nunca os brutos do pedido. */
  pairsFound: number;
  attempts: number;
  timeSeconds: number;
}

/**
 * Pontuação da Memória (secção 12). Função pura, chamada pelo servidor no
 * momento da conclusão — nunca confiar na pontuação calculada pelo cliente.
 *
 * `pairsFound`/`attempts`/`timeSeconds` vêm de um pedido do cliente (o
 * ecrã de jogo só reporta o resultado no fim); sem clamping, um pedido
 * manipulado (ex.: pairsFound=999999) inflacionava a pontuação sem limite e
 * corrompia estatísticas/ranking.
 */
export function computeMemoryScore(input: MemoryScoringInput): MemoryScoringResult {
  const { pairsTotal, config } = input;

  const pairsFound = Math.max(0, Math.min(Math.floor(input.pairsFound) || 0, pairsTotal));
  // Nunca é possível encontrar mais pares do que tentativas feitas.
  const attempts = Math.max(pairsFound, Math.floor(input.attempts) || 0);
  const timeSeconds = Math.max(0, Math.floor(input.timeSeconds) || 0);

  const withinTimeLimit = config.timeLimitSeconds == null || timeSeconds <= config.timeLimitSeconds;
  const withinAttemptLimit = config.maxAttempts == null || attempts <= config.maxAttempts;
  const completed = pairsFound >= pairsTotal && withinTimeLimit && withinAttemptLimit;

  const mistakes = Math.max(0, attempts - pairsFound);
  let score = pairsFound * config.pointsPerPair - mistakes * config.penaltyPerMistake;

  if (completed && config.speedBonusEnabled && config.timeLimitSeconds) {
    const remainingFraction = Math.max(
      0,
      (config.timeLimitSeconds - timeSeconds) / config.timeLimitSeconds,
    );
    score += Math.round(remainingFraction * pairsTotal * config.pointsPerPair * 0.2);
  }

  return {
    score: Math.max(0, score),
    completed,
    withinTimeLimit,
    withinAttemptLimit,
    pairsFound,
    attempts,
    timeSeconds,
  };
}
