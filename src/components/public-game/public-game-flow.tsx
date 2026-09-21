"use client";

import { useEffect, useRef, useState } from "react";
import type { MemoryPlayerConfig, MemoryPlayerPair } from "@/components/public-game/memory-game-player";
import type { WheelPlayerSegment } from "@/components/public-game/wheel-game-player";
import type { QuizPlayerQuestion } from "@/components/public-game/quiz-game-player";
import { PublicMemoryGame } from "@/components/public-game/public-memory-game";
import { PublicWheelGame } from "@/components/public-game/public-wheel-game";
import { PublicQuizGame } from "@/components/public-game/public-quiz-game";
import { PublicLeadForm, type PublicConsentDefinition, type PublicLeadField } from "@/components/public-game/public-lead-form";
import {
  recordAnalyticsEventAction,
  startParticipationAction,
  submitLeadFormAction,
  submitMemoryResultAction,
  submitQuizAction,
  spinWheelAction,
} from "@/features/play/actions";

interface ScreenData {
  title: string | null;
  text: string | null;
  mediaUrl?: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  continueButtonLabel: string | null;
}

interface LeadFormData {
  position: "BEFORE_GAME" | "AFTER_GAME" | "BEFORE_RESULT" | "BEFORE_PRIZE" | "NONE";
  honeypotEnabled: boolean;
  fields: PublicLeadField[];
  consents: PublicConsentDefinition[];
}

export interface PublicGameFlowProps {
  campaignId: string;
  campaignType: "MEMORY" | "WHEEL" | "QUIZ";
  isTestMode: boolean;
  start: {
    title: string | null;
    subtitle: string | null;
    introText: string | null;
    mediaUrl?: string | null;
    logoUrl?: string | null;
    buttonLabel: string | null;
    prizeInfo: string | null;
  };
  regulationText: string | null;
  leadForm: LeadFormData | null;
  intermediateBefore: ScreenData | null;
  intermediateAfter: ScreenData | null;
  final: {
    title: string | null;
    message: string | null;
    mediaUrl?: string | null;
    ctaLabel: string | null;
    ctaUrl: string | null;
    allowReplay: boolean;
    allowShare: boolean;
  };
  memory?: { pairs: MemoryPlayerPair[]; config: MemoryPlayerConfig };
  wheel?: { segments: WheelPlayerSegment[] };
  quiz?: {
    questions: QuizPlayerQuestion[];
    allowGoBack: boolean;
    showProgress: boolean;
    totalTimeLimitSeconds: number | null;
  };
}

type Stage =
  | "start"
  | "lead-before"
  | "intermediate-before"
  | "game"
  | "intermediate-after"
  | "lead-after"
  | "final"
  | "blocked";

function buildSequence(props: PublicGameFlowProps): Stage[] {
  const sequence: Stage[] = ["start"];
  if (props.leadForm && props.leadForm.position === "BEFORE_GAME") sequence.push("lead-before");
  if (props.intermediateBefore) sequence.push("intermediate-before");
  sequence.push("game");
  if (props.intermediateAfter) sequence.push("intermediate-after");
  if (props.leadForm && props.leadForm.position !== "BEFORE_GAME" && props.leadForm.position !== "NONE") {
    sequence.push("lead-after");
  }
  sequence.push("final");
  return sequence;
}

const BLOCKED_MESSAGES: Record<string, string> = {
  limit_reached: "Já participou o número de vezes permitido nesta campanha.",
  rate_limited: "Demasiadas tentativas em pouco tempo. Tente novamente mais tarde.",
  not_active: "Esta campanha não está disponível neste momento.",
  not_found: "Campanha não encontrada.",
};

export function PublicGameFlow(props: PublicGameFlowProps) {
  const sequence = buildSequence(props);
  const [stageIndex, setStageIndex] = useState(0);
  const [participationId, setParticipationId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [showRegulation, setShowRegulation] = useState(false);
  const viewedRef = useRef(false);

  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [sessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    void recordAnalyticsEventAction(props.campaignId, "CAMPAIGN_VIEWED", props.isTestMode, sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stage = blockedReason ? "blocked" : sequence[stageIndex];

  function advance() {
    setStageIndex((i) => Math.min(i + 1, sequence.length - 1));
  }

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    setStartError(null);
    void recordAnalyticsEventAction(props.campaignId, "START_CLICKED", props.isTestMode, sessionId);
    try {
      const result = await startParticipationAction({
        campaignId: props.campaignId,
        idempotencyKey,
        sessionId,
        testRequested: props.isTestMode,
        source: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      });
      if (!result.ok) {
        setBlockedReason(result.reason);
        return;
      }
      setParticipationId(result.participationId);
      advance();
    } catch (error) {
      // Sem isto o botão ficava preso em "A preparar…" e o participante não
      // tinha forma de voltar a tentar. A chave de idempotência é a mesma, por
      // isso repetir não cria uma segunda participação.
      console.error("[play] Falha ao iniciar a participação:", error);
      setStartError("Não foi possível iniciar. Verifique a ligação e tente novamente.");
    } finally {
      setStarting(false);
    }
  }

  async function handleLeadSubmit(values: Record<string, string>, consents: Record<string, boolean>, honeypot: string) {
    if (!participationId) return { ok: false, reason: "invalid" };
    const result = await submitLeadFormAction({ participationId, values, consents, honeypot });
    if (result.ok) advance();
    return result;
  }

  if (stage === "blocked") {
    return (
      <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center text-caetano-anthracite">
        {BLOCKED_MESSAGES[blockedReason ?? ""] ?? "Não foi possível continuar."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {props.isTestMode && (
        // O CLAUDE.md §18 exige aviso visual PERMANENTE. Em linha, saía do ecrã
        // com o scroll e um jogo longo passava a parecer real.
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 border-b border-caetano-dynamic-orange bg-caetano-dynamic-orange-20 px-4 py-2 text-center text-sm font-medium text-caetano-anthracite"
        >
          Modo de teste — esta participação não conta para estatísticas nem consome stock.
        </div>
      )}
      {/* Reserva o espaço da faixa fixa para não tapar o conteúdo. */}
      {props.isTestMode && <div aria-hidden="true" className="h-9" />}

      {stage === "start" && (
        <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center">
          {props.start.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.start.logoUrl} alt="" className="mx-auto mb-4 h-12 object-contain" />
          )}
          {props.start.title && <h1 className="text-2xl font-bold text-caetano-anthracite">{props.start.title}</h1>}
          {props.start.subtitle && <p className="mt-1 text-caetano-anthracite-80">{props.start.subtitle}</p>}
          {props.start.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.start.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-lg object-contain" />
          )}
          {props.start.introText && <p className="mt-4 text-sm text-caetano-anthracite-80">{props.start.introText}</p>}
          {props.start.prizeInfo && <p className="mt-2 text-sm font-medium text-caetano-deep-blue">{props.start.prizeInfo}</p>}
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            aria-busy={starting || undefined}
            className="mt-6 cursor-pointer touch-manipulation select-none rounded-full bg-caetano-deep-blue px-8 py-3 font-bold text-white transition-[background-color,transform] duration-150 hover:bg-caetano-deep-blue-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2 active:bg-caetano-deep-blue disabled:cursor-progress disabled:opacity-60 motion-safe:active:scale-[0.97]"
          >
            {starting ? "A preparar…" : props.start.buttonLabel || "Jogar"}
          </button>
          {startError && (
            <p role="alert" className="mt-3 text-sm text-danger-strong">
              {startError}
            </p>
          )}
        </div>
      )}

      {(stage === "lead-before" || stage === "lead-after") && props.leadForm && (
        <PublicLeadForm
          fields={props.leadForm.fields}
          consents={props.leadForm.consents}
          honeypotEnabled={props.leadForm.honeypotEnabled}
          onSubmit={handleLeadSubmit}
        />
      )}

      {(stage === "intermediate-before" || stage === "intermediate-after") && (
        <IntermediateScreen
          screen={stage === "intermediate-before" ? props.intermediateBefore : props.intermediateAfter}
          onContinue={advance}
        />
      )}

      {stage === "game" && participationId && (
        <>
          {props.campaignType === "MEMORY" && props.memory && (
            <PublicMemoryGame
              pairs={props.memory.pairs}
              config={props.memory.config}
              onSubmit={(raw) => submitMemoryResultAction({ participationId, ...raw })}
              onContinue={advance}
            />
          )}
          {props.campaignType === "WHEEL" && props.wheel && (
            <PublicWheelGame
              segments={props.wheel.segments}
              onSpin={() => spinWheelAction(participationId)}
              onContinue={advance}
            />
          )}
          {props.campaignType === "QUIZ" && props.quiz && (
            <PublicQuizGame
              questions={props.quiz.questions}
              allowGoBack={props.quiz.allowGoBack}
              showProgress={props.quiz.showProgress}
              totalTimeLimitSeconds={props.quiz.totalTimeLimitSeconds}
              onSubmit={(submissions, timeSeconds) => submitQuizAction(participationId, submissions, timeSeconds)}
              onContinue={advance}
            />
          )}
        </>
      )}

      {stage === "final" && (
        <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center">
          {props.final.title && <h2 className="text-xl font-bold text-caetano-anthracite">{props.final.title}</h2>}
          {props.final.message && <p className="mt-2 text-caetano-anthracite-80">{props.final.message}</p>}
          {props.final.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.final.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-lg object-contain" />
          )}
          {props.final.ctaLabel && props.final.ctaUrl && (
            <a
              href={props.final.ctaUrl}
              className="mt-4 inline-block rounded-lg bg-caetano-deep-blue px-6 py-2.5 font-medium text-white"
            >
              {props.final.ctaLabel}
            </a>
          )}
          <div className="mt-4 flex justify-center gap-4 text-sm">
            {props.final.allowReplay && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-caetano-deep-blue underline"
              >
                Jogar novamente
              </button>
            )}
            {props.final.allowShare && typeof navigator !== "undefined" && (
              <button
                type="button"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({ url: window.location.href });
                  } else {
                    void navigator.clipboard.writeText(window.location.href);
                  }
                }}
                className="text-caetano-deep-blue underline"
              >
                Partilhar
              </button>
            )}
          </div>
        </div>
      )}

      {props.regulationText && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowRegulation((v) => !v)}
            className="text-xs text-caetano-anthracite-80 underline"
          >
            Regulamento
          </button>
          {showRegulation && (
            <p className="mt-2 whitespace-pre-line rounded-lg bg-caetano-medium-gray-20 p-3 text-left text-xs text-caetano-anthracite-80">
              {props.regulationText}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function IntermediateScreen({ screen, onContinue }: { screen: ScreenData | null; onContinue: () => void }) {
  if (!screen) return null;
  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center">
      {screen.title && <h2 className="text-lg font-bold text-caetano-anthracite">{screen.title}</h2>}
      {screen.text && <p className="mt-2 text-caetano-anthracite-80">{screen.text}</p>}
      {screen.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={screen.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-lg object-contain" />
      )}
      {screen.ctaLabel && screen.ctaUrl && (
        <a href={screen.ctaUrl} className="mt-4 inline-block text-caetano-deep-blue underline">
          {screen.ctaLabel}
        </a>
      )}
      <button
        type="button"
        onClick={onContinue}
        className="mt-4 rounded-lg bg-caetano-deep-blue px-6 py-2.5 font-medium text-white"
      >
        {screen.continueButtonLabel || "Continuar"}
      </button>
    </div>
  );
}
