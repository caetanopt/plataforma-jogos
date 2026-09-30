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
  getStoredResultAction,
  recordAnalyticsEventAction,
  resumeParticipationAction,
  startParticipationAction,
  submitLeadFormAction,
  submitMemoryResultAction,
  submitQuizAction,
  spinWheelAction,
  type ResumeParticipationResult,
  type StoredGameResult,
} from "@/features/play/actions";
import type {
  GameActionResponse,
  ParticipationRef,
  PublicLeadFormDefinition,
  PublicLegalInfo,
} from "@/features/play/types";
import { LegalFooter, PrivacyNotice } from "@/components/public-game/legal-notice";
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
  legal: PublicLegalInfo;
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

/**
 * Regista o início do jogo no servidor, com novas tentativas: numa rede móvel
 * instável um só pedido perde-se, e o relógio do servidor fica por começar.
 */
async function beginGame(ref: ParticipationRef): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if ((await beginGameAction(ref)).ok) return;
    } catch {
      // Rede: tenta de novo.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
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
  // Resultado da memória ou do quiz numa participação retomada: o jogo já não
  // aparece, por isso o ecrã final mostra-o.
  const [storedResult, setStoredResult] = useState<StoredGameResult | null>(null);
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
      let result: ResumeParticipationResult | null = null;
      if (storedRef) {
        try {
          result = await resumeParticipationAction({
            campaignId: props.campaignId,
            ref: storedRef,
            testRequested: props.isTestMode,
          });
        } catch (error) {
          // Rede: não se sabe se a participação continua válida. Fica guardada.
          console.error("[play] Falha ao retomar a participação:", error);
          result = { ok: false, reason: "retry" };
        }
      } else {
        await Promise.resolve();
      }
      if (cancelled || !stored) return;
      // Sem id, a página recarregou a meio do início; sem resposta definitiva,
      // a retoma falhou por agora. Nos dois casos o próximo "Jogar" usa a
      // mesma chave e o servidor devolve a participação já criada, em vez de
      // criar outra (ou esbarrar no limite).
      if (!storedRef || !result || (!result.ok && result.reason === "retry")) {
        setIdempotencyKey(stored.token);
        setSessionId(stored.sessionId);
        return;
      }
      if (!result.ok) {
        // Terminada há muito, noutra campanha ou já indisponível: tentativa
        // nova, com as chaves novas do estado inicial.
        clearStoredParticipation(props.campaignId, props.isTestMode);
        return;
      }
      setIdempotencyKey(stored.token);
      setSessionId(stored.sessionId);
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
        } else {
          const saved = await getStoredResultAction(storedRef);
          if (cancelled) return;
          if (saved.status === "revealed") setStoredResult(saved.result);
          else if (saved.status === "lead_required") setRevealAfterLead(true);
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
    void beginGame(ref);
  }, [stage, ref, props.campaignType]);

  async function handleStart() {
    if (starting || resuming) return;
    setStarting(true);
    setStartError(null);
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

    if (revealAfterLead && props.campaignType !== "WHEEL") {
      // Memória ou quiz retomados com o resultado retido: agora o servidor
      // já o envia, para o ecrã final.
      try {
        const revealed = await getStoredResultAction(ref);
        if (revealed.status !== "revealed") return { ok: false, reason: "result_unavailable" };
        setRevealAfterLead(false);
        setStoredResult(revealed.result);
      } catch (error) {
        console.error("[play] Falha ao obter o resultado:", error);
        return { ok: false, reason: "result_unavailable" };
      }
    } else if (prizePending || revealAfterLead) {
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
      <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center text-game-text">
        {BLOCKED_MESSAGES[blockedReason ?? ""] ?? "Não foi possível continuar."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* A faixa do modo de teste está na página (play/[slug]/page.tsx), antes do cabeçalho. */}
      {stage === "start" && (
        <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center">
          {props.start.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.start.logoUrl} alt="" className="mx-auto mb-4 h-12 object-contain" />
          )}
          {props.start.title && <h1 className="text-2xl font-bold text-game-text">{props.start.title}</h1>}
          {props.start.subtitle && <p className="mt-1 text-game-muted">{props.start.subtitle}</p>}
          {props.start.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.start.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-game object-contain" />
          )}
          {props.start.introText && <p className="mt-4 text-sm text-game-muted">{props.start.introText}</p>}
          {props.start.prizeInfo && <p className="mt-2 text-sm font-medium text-game-accent">{props.start.prizeInfo}</p>}
          <button
            type="button"
            onClick={handleStart}
            disabled={starting || resuming}
            aria-busy={starting || resuming || undefined}
            className="mt-6 cursor-pointer touch-manipulation select-none rounded-game bg-game-button px-8 py-3 font-bold text-game-button-text transition-[background-color,transform] duration-150 hover:bg-game-button-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2 active:bg-game-button disabled:cursor-progress disabled:opacity-60 motion-safe:active:scale-[0.97]"
          >
            {starting ? "A preparar…" : resuming ? "A carregar…" : props.start.buttonLabel || "Jogar"}
          </button>
          {startError && (
            <p role="alert" className="mt-3 text-sm text-game-danger">
              {startError}
            </p>
          )}
          {props.legal.legalText && (
            <p className="mt-6 whitespace-pre-line text-left text-xs text-game-muted">{props.legal.legalText}</p>
          )}
        </div>
      )}

      {resumed && stage !== "start" && (
        <p role="status" className="rounded-game bg-game-highlight px-4 py-2 text-sm text-game-highlight-text">
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
          privacyNotice={<PrivacyNotice legal={props.legal} />}
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
        <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center">
          {props.final.title && <h2 className="text-xl font-bold text-game-text">{props.final.title}</h2>}
          {props.final.message && <p className="mt-2 text-game-muted">{props.final.message}</p>}
          {prizeUnavailable && !wheelPrize && (
            <p className="mt-4 rounded-game bg-game-subtle p-4 text-sm text-game-subtle-text">
              O prémio já não pode ser atribuído a esta participação: o prazo para o reclamar terminou ou o
              stock esgotou.
            </p>
          )}
          {storedResult && <StoredResultCard stored={storedResult} />}
          {wheelPrize && (
            <div className="mt-4 rounded-game bg-game-highlight p-4 text-game-highlight-text">
              <p className="text-sm">O seu prémio</p>
              <p className="text-lg font-bold">{wheelPrize.publicName}</p>
              {wheelPrize.code && <p className="mt-1 font-mono">{wheelPrize.code}</p>}
              {wheelPrize.instructions && (
                <p className="mt-2 whitespace-pre-line text-sm">{wheelPrize.instructions}</p>
              )}
            </div>
          )}
          {props.final.mediaUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={props.final.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-game object-contain" />
          )}
          {props.final.ctaLabel && props.final.ctaUrl && (
            <a
              href={props.final.ctaUrl}
              className="mt-4 inline-block rounded-game bg-game-button px-6 py-2.5 font-medium text-game-button-text"
            >
              {props.final.ctaLabel}
            </a>
          )}
          <div className="mt-4 flex justify-center gap-4 text-sm">
            {props.final.allowReplay ? (
              <button type="button" onClick={handleReplay} className="text-game-accent underline">
                Jogar novamente
              </button>
            ) : (
              resumed && (
                // Recarregar retoma a participação; num dispositivo partilhado
                // (quiosque, tablet num evento) é assim que se passa à pessoa
                // seguinte. Os limites de participação aplicam-se na mesma.
                <button type="button" onClick={handleReplay} className="text-game-accent underline">
                  Começar uma nova participação
                </button>
              )
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
                className="text-game-accent underline"
              >
                Partilhar
              </button>
            )}
          </div>
        </div>
      )}

      <LegalFooter legal={props.legal} regulationText={props.regulationText} />
    </div>
  );
}

function StoredResultCard({ stored }: { stored: StoredGameResult }) {
  if (stored.kind === "MEMORY") {
    return (
      <div className="mt-4 rounded-game bg-game-highlight p-4 text-game-highlight-text">
        <p className="text-lg font-bold">{stored.result.completed ? "Jogo concluído!" : "Tempo esgotado"}</p>
        <p className="mt-1 text-sm">Pontuação: {stored.result.score}</p>
      </div>
    );
  }
  const { result } = stored;
  return (
    <div className="mt-4 rounded-game bg-game-highlight p-4 text-game-highlight-text">
      <p className="text-lg font-bold">
        {result.percentage.toFixed(0)}% ({result.totalScore}/{result.maxPossibleScore} pontos)
      </p>
      {result.passed != null && <p className="mt-1 text-sm">{result.passed ? "Aprovado" : "Não aprovado"}</p>}
      {result.resultProfile && (
        <div className="mt-3">
          <p className="font-medium">{result.resultProfile.title}</p>
          {result.resultProfile.description && (
            <p className="mt-1 text-sm">{result.resultProfile.description}</p>
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

function IntermediateScreen({ screen, onContinue }: { screen: ScreenData | null; onContinue: () => void }) {
  if (!screen) return null;
  return (
    <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center">
      {screen.title && <h2 className="text-lg font-bold text-game-text">{screen.title}</h2>}
      {screen.text && <p className="mt-2 text-game-muted">{screen.text}</p>}
      {screen.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={screen.mediaUrl} alt="" className="mx-auto mt-4 max-h-64 rounded-game object-contain" />
      )}
      {screen.ctaLabel && screen.ctaUrl && (
        <a href={screen.ctaUrl} className="mt-4 inline-block text-game-accent underline">
          {screen.ctaLabel}
        </a>
      )}
      <button
        type="button"
        onClick={onContinue}
        className="mt-4 rounded-game bg-game-button px-6 py-2.5 font-medium text-game-button-text"
      >
        {screen.continueButtonLabel || "Continuar"}
      </button>
    </div>
  );
}
