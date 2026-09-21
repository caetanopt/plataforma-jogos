/* eslint-disable @next/next/no-img-element */
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
  const [error, setError] = useState<string | null>(null);
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
    // Guarda partilhada com o temporizador: sem isto, esgotar o tempo durante
    // um envio manual em curso submetia as respostas duas vezes.
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    const submissions: QuizPlayerSubmission[] = questions.map((q) => ({
      questionId: q.id,
      selectedAnswerIds: selections[q.id] ?? [],
    }));
    try {
      const finalResult = await onSubmit(submissions, timeSeconds);
      setResult(finalResult);
    } catch (error) {
      console.error("[quiz] Falha ao submeter as respostas:", error);
      submittedRef.current = false;
      setError("Não foi possível submeter as respostas. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center" aria-live="polite">
        <p className="text-lg font-bold text-caetano-anthracite">
          {result.percentage.toFixed(0)}% ({result.totalScore}/{result.maxPossibleScore} pontos)
        </p>
        {result.passed != null && (
          <p className="mt-1 text-caetano-anthracite-80">{result.passed ? "Aprovado" : "Não aprovado"}</p>
        )}
        {result.resultProfile && (
          <div className="mt-4">
            <p className="font-medium text-caetano-anthracite">{result.resultProfile.title}</p>
            {result.resultProfile.description && (
              <p className="mt-1 text-sm text-caetano-anthracite-80">{result.resultProfile.description}</p>
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
  const hasAnswerImages = question.answers.some((answer) => Boolean(answer.imageUrl));

  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6">
      {showProgress && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs text-caetano-anthracite-80">
            Pergunta {index + 1} de {questions.length}
          </p>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-caetano-medium-gray-40"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-label="Progresso do quiz"
          >
            <div
              className="h-full rounded-full bg-caetano-cyan transition-[width] duration-300"
              style={{ width: `${((index + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <h3 className="text-lg font-bold text-caetano-anthracite">{question.title}</h3>
      {question.supportText && <p className="mt-1 text-sm text-caetano-anthracite-80">{question.supportText}</p>}

      {question.imageUrl && (
        <img
          src={question.imageUrl}
          alt=""
          className="mt-3 max-h-64 w-full rounded-lg object-contain"
        />
      )}

      {/* Respostas com imagem ficam em grelha; só texto mantém-se em lista. */}
      <div className={cn("mt-4", hasAnswerImages ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2")}>
        {question.answers.map((answer) => {
          const isSelected = selected.includes(answer.id);
          return (
            <button
              key={answer.id}
              type="button"
              onClick={() => toggleAnswer(answer.id)}
              aria-pressed={isSelected}
              className={cn(
                "w-full cursor-pointer touch-manipulation select-none rounded-lg border text-left text-sm",
                "transition-[background-color,border-color,transform] duration-150 motion-safe:active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-1",
                hasAnswerImages ? "block p-2" : "block px-4 py-2",
                isSelected
                  ? "border-caetano-deep-blue bg-caetano-deep-blue-20 text-caetano-deep-blue"
                  : "border-caetano-medium-gray-60 text-caetano-anthracite hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
              )}
            >
              {answer.imageUrl && (
                <img
                  src={answer.imageUrl}
                  alt=""
                  className="mb-2 aspect-square w-full rounded object-cover"
                />
              )}
              {answer.text}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-4 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

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
