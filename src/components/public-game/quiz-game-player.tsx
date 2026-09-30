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
      <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center" aria-live="polite">
        <p className="text-lg font-bold text-game-text">
          {result.percentage.toFixed(0)}% ({result.totalScore}/{result.maxPossibleScore} pontos)
        </p>
        {result.passed != null && (
          <p className="mt-1 text-game-muted">{result.passed ? "Aprovado" : "Não aprovado"}</p>
        )}
        {result.resultProfile && (
          <div className="mt-4">
            <p className="font-medium text-game-text">{result.resultProfile.title}</p>
            {result.resultProfile.description && (
              <p className="mt-1 text-sm text-game-muted">{result.resultProfile.description}</p>
            )}
            {result.resultProfile.ctaLabel && result.resultProfile.ctaUrl && (
              <a
                href={result.resultProfile.ctaUrl}
                className="mt-3 inline-block rounded-game bg-game-button px-4 py-2 text-sm text-game-button-text"
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
    <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6">
      {showProgress && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs text-game-muted">
            Pergunta {index + 1} de {questions.length}
          </p>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-game-border"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-label="Progresso do quiz"
          >
            <div
              className="h-full rounded-full bg-game-accent transition-[width] duration-300"
              style={{ width: `${((index + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <h3 className="text-lg font-bold text-game-text">{question.title}</h3>
      {question.supportText && <p className="mt-1 text-sm text-game-muted">{question.supportText}</p>}

      {question.imageUrl && (
        <img
          src={question.imageUrl}
          alt=""
          className="mt-3 max-h-64 w-full rounded-game object-contain"
        />
      )}

      {/* Respostas com imagem ficam em grelha; só texto mantém-se em lista. */}
      <div className={cn("mt-4", hasAnswerImages ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2")}>
        {question.answers.map((answer, answerIndex) => {
          const isSelected = selected.includes(answer.id);
          return (
            <button
              key={answer.id}
              type="button"
              onClick={() => toggleAnswer(answer.id)}
              aria-pressed={isSelected}
              className={cn(
                "w-full cursor-pointer touch-manipulation select-none rounded-game border text-left text-sm",
                "transition-[background-color,border-color,transform] duration-150 motion-safe:active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-1",
                hasAnswerImages ? "block p-2" : "block px-4 py-2",
                isSelected
                  ? "border-game-accent bg-game-accent-tint text-game-selected-text"
                  : "border-game-border-strong text-game-text hover:bg-game-subtle hover:text-game-subtle-text active:bg-game-subtle active:text-game-subtle-text",
              )}
            >
              {answer.imageUrl && (
                <img
                  src={answer.imageUrl}
                  // Com texto, a imagem é decorativa; sem texto é o único nome
                  // do botão para um leitor de ecrã (§27).
                  alt={answer.text ? "" : `Resposta ${answerIndex + 1}`}
                  className="mb-2 aspect-square w-full rounded object-cover"
                />
              )}
              {answer.text}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-4 text-sm text-game-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-between">
        {allowGoBack && index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            className="rounded-game border border-game-border-strong px-4 py-2 text-sm text-game-text"
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
            className="rounded-game bg-game-button px-4 py-2 text-sm text-game-button-text disabled:opacity-50"
          >
            Seguinte
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-game bg-game-button px-4 py-2 text-sm text-game-button-text disabled:opacity-50"
          >
            {submitting ? "A submeter…" : "Terminar"}
          </button>
        )}
      </div>
    </div>
  );
}
