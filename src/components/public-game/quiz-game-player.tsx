/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, Check, CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Burst, ForwardArrow, gameButtonClass, gameCardClass, gameStyles as styles, Spinner } from "@/components/public-game/game-ui";

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
    // Celebra quem passou; sem nota mínima, a partir de metade das respostas.
    const celebrate = result.passed ?? result.percentage >= 50;
    return (
      <div
        className={cn("relative isolate overflow-hidden px-6 py-9 text-center sm:px-10", gameCardClass, "motion-safe:animate-scale-in")}
        aria-live="polite"
      >
        {celebrate && <Burst className="top-29" />}
        <ScoreRing percentage={result.percentage}>
          <p className="flex flex-col items-center font-bold text-game-text">
            <span className="text-4xl tabular-nums tracking-tight">{result.percentage.toFixed(0)}%</span>{" "}
            <span className="mt-0.5 text-xs font-medium text-game-muted">
              ({result.totalScore}/{result.maxPossibleScore} pontos)
            </span>
          </p>
        </ScoreRing>
        {result.passed != null && (
          <p
            className={cn(
              "mx-auto mt-5 flex w-fit items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold",
              result.passed ? "bg-game-success-tint text-game-success-text" : "bg-game-subtle text-game-subtle-text",
            )}
          >
            {result.passed ? (
              <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <Info aria-hidden="true" className="size-4 shrink-0" />
            )}
            {result.passed ? "Aprovado" : "Não aprovado"}
          </p>
        )}
        {result.resultProfile && (
          <div className="mt-6 border-t border-game-border pt-6">
            <p className="text-balance text-xl font-bold tracking-tight text-game-text">{result.resultProfile.title}</p>
            {result.resultProfile.description && (
              <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-game-muted">
                {result.resultProfile.description}
              </p>
            )}
            {result.resultProfile.ctaLabel && result.resultProfile.ctaUrl && (
              <a
                href={result.resultProfile.ctaUrl}
                className={gameButtonClass({ variant: "secondary", size: "md", className: "mt-5" })}
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
  const multiple = question.type === "MULTIPLE_CHOICE";

  return (
    <div className={cn("p-5 sm:p-8", gameCardClass)}>
      {showProgress && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-game-muted">
            Pergunta {index + 1} de {questions.length}
          </p>
          <div
            className="h-2 overflow-hidden rounded-full bg-game-subtle"
            role="progressbar"
            aria-valuenow={index + 1}
            aria-valuemin={1}
            aria-valuemax={questions.length}
            aria-label="Progresso do quiz"
          >
            <div
              className="h-full rounded-full bg-game-accent transition-[width] duration-500 ease-(--ease-out-expo)"
              style={{ width: `${((index + 1) / questions.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Cada pergunta entra de novo ao avançar ou voltar. */}
      <div key={question.id} className="motion-safe:animate-enter">
        <h3 className="text-balance text-xl font-bold leading-snug tracking-tight text-game-text sm:text-2xl">
          {question.title}
        </h3>
        {question.supportText && <p className="mt-2 text-sm text-game-muted">{question.supportText}</p>}

        {question.imageUrl && (
          <img
            src={question.imageUrl}
            alt=""
            className="mt-4 max-h-64 w-full rounded-game object-contain"
          />
        )}

        {/* Respostas com imagem ficam em grelha; só texto mantém-se em lista. */}
        <div className={cn("mt-5", hasAnswerImages ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-3")}>
          {question.answers.map((answer, answerIndex) => {
            const isSelected = selected.includes(answer.id);
            return (
              <button
                key={answer.id}
                type="button"
                onClick={() => toggleAnswer(answer.id)}
                aria-pressed={isSelected}
                className={cn(
                  "group relative w-full cursor-pointer touch-manipulation select-none rounded-game border text-left text-base",
                  "transition-[background-color,border-color,color,box-shadow,translate,scale] duration-200 ease-(--ease-out-expo)",
                  "motion-safe:active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2 focus-visible:ring-offset-game-surface",
                  hasAnswerImages ? "block p-2" : "flex min-h-14 items-center gap-3 px-4 py-3",
                  isSelected
                    ? "border-game-accent bg-game-accent-tint font-medium text-game-selected-text shadow-[inset_0_0_0_1px_var(--game-accent)]"
                    : "border-game-border-strong bg-game-surface text-game-text shadow-(--game-elevation-sm) hover:border-game-accent hover:bg-game-subtle hover:text-game-subtle-text hover:shadow-(--game-elevation-md) active:bg-game-subtle active:text-game-subtle-text",
                )}
              >
                {/*
                  Indicador visual da escolha: redondo numa resposta única,
                  quadrado na múltipla. O estado é o aria-pressed do botão.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center border-2 transition-[background-color,border-color] duration-200",
                    multiple ? "rounded-md" : "rounded-full",
                    hasAnswerImages && "absolute right-3 top-3 z-10 bg-game-surface",
                    isSelected ? "border-game-accent bg-game-accent text-game-surface" : "border-game-border-strong",
                  )}
                >
                  {isSelected && <Check className="size-3.5 motion-safe:animate-scale-in" strokeWidth={3} />}
                </span>
                {answer.imageUrl && (
                  <img
                    src={answer.imageUrl}
                    // Com texto, a imagem é decorativa; sem texto é o único nome
                    // do botão para um leitor de ecrã (§27).
                    alt={answer.text ? "" : `Resposta ${answerIndex + 1}`}
                    className={cn("aspect-square w-full rounded-[calc(var(--game-radius)*0.75)] object-cover", answer.text && "mb-2")}
                  />
                )}
                {answer.text && <span className={cn(hasAnswerImages && "block px-1 pb-1 text-sm")}>{answer.text}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p
          className="mt-5 flex items-start gap-2 rounded-game border border-game-danger px-3 py-2.5 text-sm text-game-danger"
          role="alert"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="mt-7 flex items-center justify-between gap-3">
        {allowGoBack && index > 0 ? (
          <button
            type="button"
            onClick={() => setIndex((i) => i - 1)}
            className={gameButtonClass({ variant: "secondary", size: "lg", className: "group flex-1 px-4 sm:flex-none sm:px-6" })}
          >
            <ArrowLeft
              aria-hidden="true"
              className="size-4 shrink-0 transition-[translate] duration-200 ease-(--ease-out-expo) motion-safe:group-hover:-translate-x-0.5"
            />
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
            className={gameButtonClass({ size: "lg", className: "group flex-1 px-4 sm:min-w-36 sm:flex-none sm:px-6" })}
          >
            Seguinte
            <ForwardArrow className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            aria-busy={submitting || undefined}
            className={gameButtonClass({ size: "lg", className: "flex-1 px-4 disabled:cursor-progress sm:min-w-36 sm:flex-none sm:px-6" })}
          >
            {submitting ? <Spinner /> : <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />}
            {submitting ? "A submeter…" : "Terminar"}
          </button>
        )}
      </div>
    </div>
  );
}

// Perímetro do anel de resultado (r = 52 numa caixa de 120).
const RING_LENGTH = 2 * Math.PI * 52;

/**
 * Anel de pontuação: decorativo; a percentagem está no texto do centro. O
 * arco vai da cor de destaque à luz da secundária, como os gradientes de
 * marca (no tema Caetano, do azul profundo ao azul cyan).
 */
function ScoreRing({ percentage, children }: { percentage: number; children: ReactNode }) {
  // O id do React tem carateres que não servem numa referência url(#…).
  const gradientId = `ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clamped = Math.min(100, Math.max(0, percentage));
  return (
    <div className="relative mx-auto size-40">
      <svg viewBox="0 0 120 120" aria-hidden="true" className="absolute inset-0 size-full -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--game-accent)" }} />
            <stop offset="100%" style={{ stopColor: "var(--game-glow)" }} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="52" fill="none" strokeWidth="8" className="stroke-game-subtle" />
        <circle
          cx="60"
          cy="60"
          r="52"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - clamped / 100)}
          className={cn(clamped === 0 && "hidden", styles.ringFill)}
          style={{ "--ring-length": `${RING_LENGTH}` } as CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center px-4">{children}</div>
    </div>
  );
}
