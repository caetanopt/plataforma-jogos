"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface QuizPlayerAnswer {
  id: string;
  text?: string | null;
  imageUrl?: string | null;
}

export interface QuizPlayerQuestion {
  id: string;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IMAGE_CHOICE";
  title: string;
  supportText?: string | null;
  imageUrl?: string | null;
  answers: QuizPlayerAnswer[];
}

export interface QuizPlayerSubmission {
  questionId: string;
  selectedAnswerIds: string[];
}

export interface QuizPlayerResult {
  totalScore: number;
  maxPossibleScore: number;
  percentage: number;
  passed: boolean | null;
  resultProfile: { title: string; description: string | null; ctaLabel: string | null; ctaUrl: string | null } | null;
}

interface QuizGamePlayerProps {
  questions: QuizPlayerQuestion[];
  allowGoBack: boolean;
  showProgress: boolean;
  totalTimeLimitSeconds: number | null;
  onSubmit: (submissions: QuizPlayerSubmission[], timeSeconds: number) => Promise<QuizPlayerResult>;
}

export function QuizGamePlayer({
  questions,
  allowGoBack,
  showProgress,
  totalTimeLimitSeconds,
  onSubmit,
}: QuizGamePlayerProps) {
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<QuizPlayerResult | null>(null);
  const submittedRef = useRef(false);

  const question = questions[index];

  useEffect(() => {
    if (result) return;
    const interval = setInterval(() => setTimeSeconds((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [result]);

  useEffect(() => {
    if (result || submittedRef.current) return;
    if (totalTimeLimitSeconds != null && timeSeconds >= totalTimeLimitSeconds) {
      submittedRef.current = true;
      void handleSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeSeconds, totalTimeLimitSeconds, result]);

  function toggleAnswer(answerId: string) {
    setSelections((prev) => {
      const current = prev[question.id] ?? [];
      if (question.type === "MULTIPLE_CHOICE") {
        const next = current.includes(answerId)
          ? current.filter((id) => id !== answerId)
          : [...current, answerId];
        return { ...prev, [question.id]: next };
      }
      return { ...prev, [question.id]: [answerId] };
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    const submissions: QuizPlayerSubmission[] = questions.map((q) => ({
      questionId: q.id,
      selectedAnswerIds: selections[q.id] ?? [],
    }));
    const finalResult = await onSubmit(submissions, timeSeconds);
    setResult(finalResult);
    setSubmitting(false);
  }

  if (result) {
    return (
      <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6 text-center" aria-live="polite">
        <p className="text-lg font-semibold text-caetano-anthracite">
          {result.percentage.toFixed(0)}% ({result.totalScore}/{result.maxPossibleScore} pontos)
        </p>
        {result.passed != null && (
          <p className="mt-1 text-caetano-medium-gray">{result.passed ? "Aprovado" : "Não aprovado"}</p>
        )}
        {result.resultProfile && (
          <div className="mt-4">
            <p className="font-medium text-caetano-anthracite">{result.resultProfile.title}</p>
            {result.resultProfile.description && (
              <p className="mt-1 text-sm text-caetano-medium-gray">{result.resultProfile.description}</p>
            )}
            {result.resultProfile.ctaLabel && result.resultProfile.ctaUrl && (
              <a
                href={result.resultProfile.ctaUrl}
                className="mt-3 inline-block rounded-lg bg-caetano-deep-blue px-4 py-2 text-sm text-white"
              >
                {result.resultProfile.ctaLabel}
              </a>
            )}
          </div>
        )}
      </div>
    );
  }

  if (!question) return null;

  const selected = selections[question.id] ?? [];

  return (
    <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6">
      {showProgress && (
        <p className="mb-3 text-xs text-caetano-medium-gray">
          Pergunta {index + 1} de {questions.length}
        </p>
      )}

      <h3 className="text-lg font-semibold text-caetano-anthracite">{question.title}</h3>
      {question.supportText && <p className="mt-1 text-sm text-caetano-medium-gray">{question.supportText}</p>}

      <div className="mt-4 space-y-2">
        {question.answers.map((answer) => {
          const isSelected = selected.includes(answer.id);
          return (
            <button
              key={answer.id}
              type="button"
              onClick={() => toggleAnswer(answer.id)}
              aria-pressed={isSelected}
              className={cn(
                "block w-full rounded-lg border px-4 py-2 text-left text-sm",
                isSelected
                  ? "border-caetano-deep-blue bg-caetano-deep-blue/5 text-caetano-deep-blue"
                  : "border-caetano-medium-gray/40 text-caetano-anthracite hover:bg-neutral-50",
              )}
            >
              {answer.text}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between">
        {allowGoBack && index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            className="rounded-lg border border-caetano-medium-gray px-4 py-2 text-sm text-caetano-anthracite"
          >
            Voltar
          </button>
        ) : (
          <span />
        )}

        {index < questions.length - 1 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            disabled={selected.length === 0 && question.type !== "MULTIPLE_CHOICE"}
            className="rounded-lg bg-caetano-deep-blue px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Seguinte
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-caetano-deep-blue px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {submitting ? "A submeter…" : "Terminar"}
          </button>
        )}
      </div>
    </div>
  );
}
