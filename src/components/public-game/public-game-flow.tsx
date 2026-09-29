"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryPlayerConfig, MemoryPlayerPair } from "@/components/public-game/memory-game-player";
import type { WheelPlayerSegment, WheelSpinResult } from "@/components/public-game/wheel-game-player";
import type { QuizPlayerQuestion } from "@/components/public-game/quiz-game-player";
import { PublicMemoryGame } from "@/components/public-game/public-memory-game";
import { PublicWheelGame } from "@/components/public-game/public-wheel-game";
import { PublicQuizGame } from "@/components/public-game/public-quiz-game";
import { PublicLeadForm } from "@/components/public-game/public-lead-form";
import {
  beginGameAction,
  recordAnalyticsEventAction,
  resumeParticipationAction,
  startParticipationAction,
  submitLeadFormAction,
  submitMemoryResultAction,
  submitQuizAction,
  spinWheelAction,
} from "@/features/play/actions";
import type { GameActionResponse, ParticipationRef, PublicLeadFormDefinition } from "@/features/play/types";
import {
  clearStoredParticipation,
  readStoredParticipation,
  writeStoredParticipation,
} from "@/features/play/resume-storage";

interface ScreenData {
  title: string | null;
  text: string | null;
  mediaUrl?: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  continueButtonLabel: string | null;
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

const STAGE_ORDER: readonly Exclude<Stage, "blocked">[] = [
  "start",
  "lead-before",
  "intermediate-before",
  "game",
  "intermediate-after",
  "lead-after",
  "final",
];

/**
 * Etapa seguinte a `current`, saltando as que não se aplicam.
 *
 * O formulário vem do servidor no início (e na retoma), com a posição
 * fixada nessa participação — não da página. "Antes de revelar o resultado"
 * não é uma etapa própria: o formulário aparece dentro do jogo, no momento
 * em que o servidor responde que o resultado está calculado mas retido (ver
 * `runGameAction`). "Antes de revelar o prémio" e "Depois do jogo" usam a
 * etapa depois do jogo; um formulário já submetido não volta a aparecer.
 */
function nextStage(
  current: Stage,
  context: { leadForm: PublicLeadFormDefinition | null; leadSubmitted: boolean; before: boolean; after: boolean },
): Stage {
  const { leadForm, leadSubmitted } = context;
  const included = (stage: Stage) => {
    switch (stage) {
      case "lead-before":
        return leadForm?.position === "BEFORE_GAME" && !leadSubmitted;
      case "intermediate-before":
        return context.before;
      case "intermediate-after":
        return context.after;
      case "lead-after":
        return (leadForm?.position === "AFTER_GAME" || leadForm?.position === "BEFORE_PRIZE") && !leadSubmitted;
      default:
        return true;
    }
  };
  const start = STAGE_ORDER.indexOf(current as Exclude<Stage, "blocked">);
  for (let i = start + 1; i < STAGE_ORDER.length; i += 1) {
    if (included(STAGE_ORDER[i])) return STAGE_ORDER[i];
  }
  return "final";
}

const BLOCKED_MESSAGES: Record<string, string> = {
  limit_reached: "Já participou o número de vezes permitido nesta campanha.",
  rate_limited: "Demasiadas tentativas em pouco tempo. Tente novamente mais tarde.",
  not_active: "Esta campanha não está disponível neste momento.",
  not_found: "Campanha não encontrada.",
  lead_missing: "É preciso preencher o formulário antes de jogar.",
  no_segments: "De momento não há prémios em jogo nesta roda. Tente novamente mais tarde.",
};

class GameBlockedError extends Error {
  constructor() {
    super("Participação bloqueada pelo servidor.");
    this.name = "GameBlockedError";
  }
}

export function PublicGameFlow(props: PublicGameFlowProps) {
  const [currentStage, setCurrentStage] = useState<Stage>("start");
  const [participationId, setParticipationId] = useState<string | null>(null);
  const [leadForm, setLeadForm] = useState<PublicLeadFormDefinition | null>(null);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [resumed, setResumed] = useState(false);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [showRegulation, setShowRegulation] = useState(false);
  const viewedRef = useRef(false);
  const begunRef = useRef<string | null>(null);

  // A chave de idempotência é também o token de posse da participação: o
  // servidor exige-a em todas as ações depois do início (ParticipationRef).
  // Fica no separador (sessionStorage) para a participação sobreviver a um
  // F5 — antes vivia só em memória e recarregar criava outra participação ou
  // esbarrava no limite.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const ref = useMemo<ParticipationRef | null>(
    () => (participationId ? { participationId, token: idempotencyKey } : null),
    [participationId, idempotencyKey],
  );
  const flowContext = {
    leadForm,
    leadSubmitted,
    before: Boolean(props.intermediateBefore),
    after: Boolean(props.intermediateAfter),
  };

  // Formulário a meio do jogo ("Antes de revelar o resultado"): o jogo fica
  // montado mas escondido, à espera, e retoma quando o formulário é aceite.
  const [awaitingLead, setAwaitingLead] = useState(false);
  const leadGateResolver = useRef<(() => void) | null>(null);

  // Prémio da roda para o ecrã final. Com "Antes de revelar o prémio" só é
  // conhecido depois do formulário.
  const [wheelPrize, setWheelPrize] = useState<WheelSpinResult["prize"]>(null);
  const [prizePending, setPrizePending] = useState(false);
  const [prizeUnavailable, setPrizeUnavailable] = useState(false);
  // Retoma de uma roda com o resultado retido ("Antes de revelar o
  // resultado"): o prémio só é pedido depois do formulário.
  const [revealAfterLead, setRevealAfterLead] = useState(false);
  const gameContainerRef = useRef<HTMLDivElement>(null);

  const stage = blockedReason ? "blocked" : currentStage;

  function advance() {
    setCurrentStage((current) => nextStage(current, flowContext));
  }

  function applySpin(result: WheelSpinResult) {
    setPrizePending(result.prizePending);
    setPrizeUnavailable(result.prizeUnavailable);
    if (result.prize) setWheelPrize(result.prize);
  }

  // Retoma: com uma participação guardada neste separador, o servidor diz em
  // que ponto ficou. Sem ela (ou recusada), começa-se do início.
  useEffect(() => {
    let cancelled = false;
    const stored = readStoredParticipation(props.campaignId, props.isTestMode);
    const storedRef = stored?.participationId ? { participationId: stored.participationId, token: stored.token } : null;

    (async () => {
      const result = storedRef
        ? await resumeParticipationAction({ campaignId: props.campaignId, ref: storedRef, testRequested: props.isTestMode })
        : await Promise.resolve(null);
      if (cancelled || !stored) return;
      setIdempotencyKey(stored.token);
      setSessionId(stored.sessionId);
      // Sem id, a página recarregou a meio do início: o próximo "Jogar" usa a
      // mesma chave e o servidor devolve a participação já criada.
      if (!storedRef || !result) return;
      if (!result.ok) {
        // Terminada há muito, noutra campanha ou já indisponível: tentativa nova.
        clearStoredParticipation(props.campaignId, props.isTestMode);
        setIdempotencyKey(crypto.randomUUID());
        setSessionId(crypto.randomUUID());
        return;
      }
      setParticipationId(result.participationId);
      setLeadForm(result.leadForm);
      setLeadSubmitted(result.leadSubmitted);
      const position = result.leadForm?.position ?? null;

      if (!result.completed) {
        setCurrentStage(position === "BEFORE_GAME" && !result.leadSubmitted ? "lead-before" : "game");
      } else {
        const leadStillNeeded = position !== null && position !== "BEFORE_GAME" && !result.leadSubmitted;
        if (props.campaignType === "WHEEL") {
          // Idempotente: devolve o resultado gravado, nunca sorteia de novo.
          const spin = await spinWheelAction(storedRef);
          if (cancelled) return;
          if (spin.status === "revealed") applySpin(spin.result);
          else if (spin.status === "lead_required") setRevealAfterLead(true);
        }
        setCurrentStage(leadStillNeeded ? "lead-after" : "final");
      }
      setResumed(true);
    })()
      .catch((error: unknown) => {
        console.error("[play] Falha ao retomar a participação:", error);
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
    // Só no carregamento da página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    void recordAnalyticsEventAction(props.campaignId, "CAMPAIGN_VIEWED", props.isTestMode, sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O relógio do servidor começa quando o jogo aparece (memória e quiz);
  // recarregar não o repõe.
  useEffect(() => {
    if (stage !== "game" || !ref || props.campaignType === "WHEEL") return;
    if (begunRef.current === ref.participationId) return;
    begunRef.current = ref.participationId;
    void beginGameAction(ref).catch(() => undefined);
  }, [stage, ref, props.campaignType]);

  async function handleStart() {
    if (starting || resuming) return;
    setStarting(true);
    setStartError(null);
    void recordAnalyticsEventAction(props.campaignId, "START_CLICKED", props.isTestMode, sessionId);
    // Guardado antes do pedido: se a página recarregar a meio, o próximo
    // "Jogar" repete a mesma chave e não cria uma segunda participação.
    writeStoredParticipation(props.campaignId, props.isTestMode, { token: idempotencyKey, sessionId });
    try {
      const result = await startParticipationAction({
        campaignId: props.campaignId,
        idempotencyKey,
        sessionId,
        testRequested: props.isTestMode,
        source: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      });
      if (!result.ok) {
        clearStoredParticipation(props.campaignId, props.isTestMode);
        setBlockedReason(result.reason);
        return;
      }
      writeStoredParticipation(props.campaignId, props.isTestMode, {
        token: idempotencyKey,
        sessionId,
        participationId: result.participationId,
      });
      setParticipationId(result.participationId);
      setLeadForm(result.leadForm);
      setCurrentStage(nextStage("start", { ...flowContext, leadForm: result.leadForm, leadSubmitted: false }));
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

  /**
   * Corre uma ação de jogo e trata as respostas do servidor que não são o
   * resultado: com o resultado retido, mostra o formulário e repete a mesma
   * ação depois (é idempotente — devolve o resultado já gravado); bloqueada,
   * passa ao ecrã de bloqueio.
   */
  async function runGameAction<T>(call: () => Promise<GameActionResponse<T>>): Promise<T> {
    let response = await call();
    // O servidor pede o formulário antes de jogar (a posição mudou desde o
    // início): com um formulário para mostrar, segue o mesmo caminho.
    const leadMissing = response.status === "blocked" && response.reason === "lead_missing" && leadForm !== null;
    if (response.status === "lead_required" || leadMissing) {
      await new Promise<void>((resolve) => {
        leadGateResolver.current = resolve;
        setAwaitingLead(true);
      });
      response = await call();
    }
    if (response.status === "revealed") return response.result;
    // Um segundo lead_required não devia acontecer (só com o honeypot, que
    // finge sucesso sem gravar): mensagem genérica em vez de "Campanha não
    // encontrada", que não é verdade.
    setBlockedReason(response.status === "blocked" ? response.reason : "unexpected");
    throw new GameBlockedError();
  }

  async function spinWheel(currentRef: ParticipationRef): Promise<WheelSpinResult> {
    const result = await runGameAction(() => spinWheelAction(currentRef));
    applySpin(result);
    return result;
  }

  async function handleLeadSubmit(values: Record<string, string>, consents: Record<string, boolean>, honeypot: string) {
    if (!ref) return { ok: false, reason: "invalid" };
    const result = await submitLeadFormAction({ ref, values, consents, honeypot });
    if (!result.ok) return result;
    setLeadSubmitted(true);

    if (leadGateResolver.current) {
      const resume = leadGateResolver.current;
      leadGateResolver.current = null;
      setAwaitingLead(false);
      resume();
      // O jogo volta a ficar visível: o foco acompanha-o, para o resultado ser
      // lido a seguir em vez de o foco cair no início da página.
      requestAnimationFrame(() => gameContainerRef.current?.focus());
      return result;
    }

    if (prizePending || revealAfterLead) {
      // O formulário foi aceite: agora o servidor já envia o prémio (ou o
      // código). Sem ele não se avança — o ecrã final ficava sem prémio e sem
      // forma de o recuperar. Repetir o envio é seguro: o formulário já
      // gravado devolve sucesso e a revelação é tentada outra vez.
      try {
        const revealed = await spinWheelAction(ref);
        if (revealed.status !== "revealed" || revealed.result.prizePending) {
          return { ok: false, reason: "prize_unavailable" };
        }
        setRevealAfterLead(false);
        setPrizePending(false);
        setPrizeUnavailable(revealed.result.prizeUnavailable);
        setWheelPrize(revealed.result.prize);
      } catch (error) {
        console.error("[play] Falha ao obter o prémio:", error);
        return { ok: false, reason: "prize_unavailable" };
      }
    }
    setCurrentStage((current) => nextStage(current, { ...flowContext, leadSubmitted: true }));
    return result;
  }

  function handleReplay() {
    // Uma tentativa nova, sujeita aos limites: não retoma esta.
    clearStoredParticipation(props.campaignId, props.isTestMode);
    window.location.reload();
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
            disabled={starting || resuming}
            aria-busy={starting || resuming || undefined}
            className="mt-6 cursor-pointer touch-manipulation select-none rounded-full bg-caetano-deep-blue px-8 py-3 font-bold text-white transition-[background-color,transform] duration-150 hover:bg-caetano-deep-blue-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2 active:bg-caetano-deep-blue disabled:cursor-progress disabled:opacity-60 motion-safe:active:scale-[0.97]"
          >
            {starting ? "A preparar…" : resuming ? "A carregar…" : props.start.buttonLabel || "Jogar"}
          </button>
          {startError && (
            <p role="alert" className="mt-3 text-sm text-danger-strong">
              {startError}
            </p>
          )}
        </div>
      )}

      {resumed && stage !== "start" && (
        <p role="status" className="rounded-lg bg-caetano-cyan-20 px-4 py-2 text-sm text-caetano-anthracite">
          Retomámos a sua participação.
        </p>
      )}

      {(stage === "lead-before" || stage === "lead-after" || awaitingLead) &&
        leadForm &&
        leadForm.fields.length + leadForm.consents.length > 0 && (
        <PublicLeadForm
          fields={leadForm.fields}
          consents={leadForm.consents}
          honeypotEnabled={leadForm.honeypotEnabled}
          intro={
            awaitingLead || revealAfterLead
              ? "O seu resultado está pronto. Preencha os seus dados para o ver."
              : prizePending && wheelPrize
                ? "Preencha os seus dados para receber o código do prémio."
                : prizePending
                  ? "Preencha os seus dados para receber o prémio."
                  : undefined
          }
          submitLabel={awaitingLead ? "Ver o resultado" : undefined}
          onSubmit={handleLeadSubmit}
        />
      )}

      {(stage === "intermediate-before" || stage === "intermediate-after") && (
        <IntermediateScreen
          screen={stage === "intermediate-before" ? props.intermediateBefore : props.intermediateAfter}
          onContinue={advance}
        />
      )}

      {stage === "game" && ref && (
        // Escondido (não desmontado) enquanto o formulário está aberto, para
        // o jogo retomar exatamente onde estava.
        <div ref={gameContainerRef} hidden={awaitingLead} tabIndex={-1} className="outline-none">
          {props.campaignType === "MEMORY" && props.memory && (
            <PublicMemoryGame
              pairs={props.memory.pairs}
              config={props.memory.config}
              onSubmit={(raw) => runGameAction(() => submitMemoryResultAction({ ref, ...raw }))}
              onContinue={advance}
            />
          )}
          {props.campaignType === "WHEEL" && props.wheel && (
            <PublicWheelGame
              segments={props.wheel.segments}
              onSpin={() => spinWheel(ref)}
              onContinue={advance}
            />
          )}
          {props.campaignType === "QUIZ" && props.quiz && (
            <PublicQuizGame
              questions={props.quiz.questions}
              allowGoBack={props.quiz.allowGoBack}
              showProgress={props.quiz.showProgress}
              totalTimeLimitSeconds={props.quiz.totalTimeLimitSeconds}
              onSubmit={(submissions, timeSeconds) =>
                runGameAction(() => submitQuizAction(ref, submissions, timeSeconds))
              }
              onContinue={advance}
            />
          )}
        </div>
      )}

      {stage === "final" && (
        <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center">
          {props.final.title && <h2 className="text-xl font-bold text-caetano-anthracite">{props.final.title}</h2>}
          {props.final.message && <p className="mt-2 text-caetano-anthracite-80">{props.final.message}</p>}
          {prizeUnavailable && !wheelPrize && (
            <p className="mt-4 rounded-lg bg-caetano-medium-gray-20 p-4 text-sm text-caetano-anthracite">
              O prémio já não pode ser atribuído a esta participação: o prazo para o reclamar terminou ou o
              stock esgotou.
            </p>
          )}
          {wheelPrize && (
            <div className="mt-4 rounded-lg bg-caetano-cyan-20 p-4 text-caetano-anthracite">
              <p className="text-sm">O seu prémio</p>
              <p className="text-lg font-bold">{wheelPrize.publicName}</p>
              {wheelPrize.code && <p className="mt-1 font-mono">{wheelPrize.code}</p>}
              {wheelPrize.instructions && (
                <p className="mt-2 whitespace-pre-line text-sm text-caetano-anthracite-80">{wheelPrize.instructions}</p>
              )}
            </div>
          )}
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
              <button type="button" onClick={handleReplay} className="text-caetano-deep-blue underline">
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
