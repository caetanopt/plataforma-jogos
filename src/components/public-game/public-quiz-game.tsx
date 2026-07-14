"use client";

import { useState } from "react";
import {
  QuizGamePlayer,
  type QuizPlayerQuestion,
  type QuizPlayerResult,
  type QuizPlayerSubmission,
} from "@/components/public-game/quiz-game-player";

export function PublicQuizGame({
  questions,
  allowGoBack,
  showProgress,
  totalTimeLimitSeconds,
  onSubmit,
  onContinue,
}: {
  questions: QuizPlayerQuestion[];
  allowGoBack: boolean;
  showProgress: boolean;
  totalTimeLimitSeconds: number | null;
  onSubmit: (submissions: QuizPlayerSubmission[], timeSeconds: number) => Promise<QuizPlayerResult>;
  onContinue: () => void;
}) {
  const [resultReady, setResultReady] = useState(false);

  async function handleSubmit(submissions: QuizPlayerSubmission[], timeSeconds: number) {
    const result = await onSubmit(submissions, timeSeconds);
    setResultReady(true);
    return result;
  }

  return (
    <div className="space-y-4">
      <QuizGamePlayer
        questions={questions}
        allowGoBack={allowGoBack}
        showProgress={showProgress}
        totalTimeLimitSeconds={totalTimeLimitSeconds}
        onSubmit={handleSubmit}
      />
      {resultReady && (
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white"
        >
          Continuar
        </button>
      )}
    </div>
  );
}
