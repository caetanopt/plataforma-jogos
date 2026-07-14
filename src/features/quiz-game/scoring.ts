export interface QuizScoringQuestion {
  id: string;
  points: number;
  correctAnswerIds: string[];
}

export interface QuizScoringSubmission {
  questionId: string;
  selectedAnswerIds: string[];
}

export interface QuizScoringConfig {
  penaltyPerWrong: number;
  speedBonusEnabled: boolean;
  totalTimeLimitSeconds: number | null;
  minPassPercentage: number | null;
}

export interface QuizQuestionResult {
  questionId: string;
  correct: boolean;
  points: number;
}

export interface QuizScoringResult {
  questionResults: QuizQuestionResult[];
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  passed: boolean | null;
}

function sameAnswerSet(selected: string[], correct: string[]): boolean {
  if (selected.length !== correct.length) return false;
  const correctSet = new Set(correct);
  return selected.every((id) => correctSet.has(id));
}

/**
 * Pontuação do Quiz Interativo (secção 14). Função pura, chamada pelo
 * servidor a partir das respostas submetidas — as respostas corretas nunca
 * são enviadas ao cliente antes da submissão.
 */
export function computeQuizScore(
  questions: QuizScoringQuestion[],
  submissions: QuizScoringSubmission[],
  timeSeconds: number,
  config: QuizScoringConfig,
): QuizScoringResult {
  const submissionByQuestion = new Map(submissions.map((s) => [s.questionId, s.selectedAnswerIds]));

  const questionResults: QuizQuestionResult[] = questions.map((question) => {
    const selected = submissionByQuestion.get(question.id) ?? [];
    const correct = sameAnswerSet(selected, question.correctAnswerIds);
    return { questionId: question.id, correct, points: correct ? question.points : 0 };
  });

  const rawScore = questionResults.reduce(
    (sum, r) => sum + (r.correct ? r.points : -config.penaltyPerWrong),
    0,
  );
  const maxPossibleScore = questions.reduce((sum, q) => sum + q.points, 0);

  let totalScore = Math.max(0, rawScore);

  if (
    config.speedBonusEnabled &&
    config.totalTimeLimitSeconds &&
    timeSeconds < config.totalTimeLimitSeconds &&
    questionResults.every((r) => r.correct)
  ) {
    const remainingFraction = Math.max(
      0,
      (config.totalTimeLimitSeconds - timeSeconds) / config.totalTimeLimitSeconds,
    );
    totalScore += Math.round(remainingFraction * maxPossibleScore * 0.2);
  }

  const percentage = maxPossibleScore > 0 ? Math.min(100, (totalScore / maxPossibleScore) * 100) : 0;
  const passed = config.minPassPercentage != null ? percentage >= config.minPassPercentage : null;

  return { questionResults, totalScore, maxPossibleScore, percentage, passed };
}

export interface ResultProfileRange {
  id: string;
  minPercentage: number;
  maxPercentage: number;
}

export function matchResultProfile(
  percentage: number,
  profiles: ResultProfileRange[],
): string | null {
  const match = profiles.find((p) => percentage >= p.minPercentage && percentage <= p.maxPercentage);
  return match?.id ?? null;
}
