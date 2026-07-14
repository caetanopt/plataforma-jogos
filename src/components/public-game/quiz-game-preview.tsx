"use client";

import {
  QuizGamePlayer,
  type QuizPlayerQuestion,
  type QuizPlayerResult,
  type QuizPlayerSubmission,
} from "@/components/public-game/quiz-game-player";
import { computeQuizScore, matchResultProfile } from "@/features/quiz-game/scoring";

interface PreviewQuestion extends QuizPlayerQuestion {
  points: number;
  correctAnswerIds: string[];
}

interface PreviewResultProfile {
  id: string;
  minPercentage: number;
  maxPercentage: number;
  title: string;
  description: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export function QuizGamePreview({
  questions,
  resultProfiles,
  config,
}: {
  questions: PreviewQuestion[];
  resultProfiles: PreviewResultProfile[];
  config: {
    allowGoBack: boolean;
    showProgress: boolean;
    totalTimeLimitSeconds: number | null;
    penaltyPerWrong: number;
    speedBonusEnabled: boolean;
    minPassPercentage: number | null;
  };
}) {
  if (questions.length === 0) {
    return (
      <p className="text-sm text-caetano-medium-gray">Adicione pelo menos uma pergunta para pré-visualizar o quiz.</p>
    );
  }

  async function handleSubmit(
    submissions: QuizPlayerSubmission[],
    timeSeconds: number,
  ): Promise<QuizPlayerResult> {
    const scored = computeQuizScore(
      questions.map((q) => ({ id: q.id, points: q.points, correctAnswerIds: q.correctAnswerIds })),
      submissions,
      timeSeconds,
      {
        penaltyPerWrong: config.penaltyPerWrong,
        speedBonusEnabled: config.speedBonusEnabled,
        totalTimeLimitSeconds: config.totalTimeLimitSeconds,
        minPassPercentage: config.minPassPercentage,
      },
    );
    const profileId = matchResultProfile(scored.percentage, resultProfiles);
    const profile = resultProfiles.find((p) => p.id === profileId) ?? null;

    return {
      totalScore: scored.totalScore,
      maxPossibleScore: scored.maxPossibleScore,
      percentage: scored.percentage,
      passed: scored.passed,
      resultProfile: profile,
    };
  }

  return (
    <QuizGamePlayer
      questions={questions}
      allowGoBack={config.allowGoBack}
      showProgress={config.showProgress}
      totalTimeLimitSeconds={config.totalTimeLimitSeconds}
      onSubmit={handleSubmit}
    />
  );
}
