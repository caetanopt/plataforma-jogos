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
}

/**
 * Pontuação da Memória (secção 12). Função pura, chamada pelo servidor no
 * momento da conclusão — nunca confiar na pontuação calculada pelo cliente.
 */
export function computeMemoryScore(input: MemoryScoringInput): MemoryScoringResult {
  const { pairsTotal, pairsFound, attempts, timeSeconds, config } = input;

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

  return { score: Math.max(0, score), completed, withinTimeLimit, withinAttemptLimit };
}
