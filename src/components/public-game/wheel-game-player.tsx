"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CircleAlert, Gift, RotateCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectedWheelOutcome } from "@/features/play/reveal";
import { Burst, gameButtonClass, gameCardClass, gameStyles as styles, ResultBadge, Spinner } from "@/components/public-game/game-ui";

export interface WheelPlayerSegment {
  id: string;
  name: string;
  colorHex: string;
}

/**
 * Resultado de uma rotação, tal como o servidor o projeta: sem o id interno
 * do prémio, e com o prémio ou o código retidos até ao formulário quando a
 * posição o pede (ver `projectWheelOutcome`).
 */
export type WheelSpinResult = ProjectedWheelOutcome;

interface WheelGamePlayerProps {
  segments: WheelPlayerSegment[];
  onSpin: () => Promise<WheelSpinResult>;
  /** Disparado quando o resultado fica visível, não quando o servidor responde. */
  onResultRevealed?: () => void;
}

const EXTRA_SPINS = 5;
const SPIN_DURATION_MS = 4000;

// Luzes do aro: posições num círculo (em % da roda), fixas.
const BULBS = Array.from({ length: 16 }, (_, i) => {
  const angle = (i / 16) * 2 * Math.PI;
  return { x: 50 + 46.5 * Math.sin(angle), y: 50 - 46.5 * Math.cos(angle) };
});

// Os nomes vão ao longo do raio, do centro para o aro, centrados a 29
// unidades do centro (caixa 0-100): entre o centro da roda e o aro.
const LABEL_OFFSET = 21;
const LABEL_MAX_CHARS = 18;
const LABEL_MAX_LENGTH = 36;

/** Nome curto para caber no segmento; o nome completo está na descrição da roda. */
function shortLabel(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > LABEL_MAX_CHARS ? `${trimmed.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…` : trimmed;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function WheelGamePlayer({ segments, onSpin, onResultRevealed }: WheelGamePlayerProps) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [animated, setAnimated] = useState(true);
  const [result, setResult] = useState<WheelSpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimer.current) clearTimeout(revealTimer.current);
    };
  }, []);

  const sliceDegrees = 360 / Math.max(1, segments.length);
  // Letra mais pequena quando há muitos segmentos (fatias estreitas) ou o
  // nome é comprido (tem de caber entre o centro e o aro).
  const baseLabelSize = segments.length > 8 ? 4.2 : segments.length > 5 ? 5.2 : 5.8;

  function reveal(spinResult: WheelSpinResult) {
    setResult(spinResult);
    setSpinning(false);
    onResultRevealed?.();
  }

  async function handleSpin() {
    if (spinning || result) return;
    setSpinning(true);
    setError(null);
    try {
      const spinResult = await onSpin();
      const targetIndex = segments.findIndex((s) => s.id === spinResult.segmentId);
      const landingIndex = targetIndex >= 0 ? targetIndex : 0;
      const sliceCenter = landingIndex * sliceDegrees + sliceDegrees / 2;

      // Alternativa não animada exigida pelo CLAUDE.md §27. Sem isto, a folha
      // de estilos global anulava a transição mas o temporizador de 4s ficava,
      // e quem pediu movimento reduzido esperava 4 segundos por um ecrã parado.
      const reduced = prefersReducedMotion();
      setAnimated(!reduced);
      setRotation(reduced ? 360 - sliceCenter : 360 * EXTRA_SPINS - sliceCenter);

      if (reduced) {
        reveal(spinResult);
        return;
      }
      revealTimer.current = setTimeout(() => reveal(spinResult), SPIN_DURATION_MS);
    } catch (error) {
      console.error("[wheel] Falha ao rodar a roda:", error);
      setError("Não foi possível determinar o resultado. Tente novamente.");
      setSpinning(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div className={cn("flex w-full flex-col items-center gap-7 px-5 pb-7 pt-9 sm:px-10 sm:pt-11", gameCardClass)}>
        {/*
          A roda acompanha a largura disponível em vez de ficar presa a um
          tamanho fixo, que transbordava em ecrãs estreitos.
        */}
        <div className="relative aspect-square w-full max-w-80 sm:max-w-96">
          <div aria-hidden="true" className={styles.wheelGlow} />
          {/* Aro, com as luzes que piscam enquanto a roda gira. */}
          <div
            aria-hidden="true"
            className={cn("absolute inset-0 rounded-full shadow-(--game-elevation-lg)", styles.wheelRim, spinning && styles.bulbsSpinning)}
          >
            {BULBS.map((bulb, index) => (
              <span
                key={index}
                className={cn("absolute size-[3.2%] -translate-x-1/2 -translate-y-1/2 rounded-full", styles.bulb)}
                style={{ left: `${bulb.x}%`, top: `${bulb.y}%`, "--i": index } as CSSProperties}
              />
            ))}
          </div>
          <div
            className={cn("absolute inset-[7%] overflow-hidden rounded-full", styles.wheelFace)}
            style={{
              transform: `rotate(${rotation}deg)`,
              transition:
                spinning && animated ? `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : undefined,
              background: `conic-gradient(${segments
                .map((s, i) => `${s.colorHex} ${i * sliceDegrees}deg ${(i + 1) * sliceDegrees}deg`)
                .join(", ")})`,
            }}
            role="img"
            aria-label={`Roda com ${segments.length} segmentos: ${segments.map((s) => s.name).join(", ")}`}
          >
            {/* Divisórias e nomes dos segmentos, que rodam com a roda. */}
            <svg viewBox="0 0 100 100" aria-hidden="true" className="absolute inset-0 size-full">
              {segments.length > 1 &&
                segments.map((segment, i) => (
                  <line
                    key={`${segment.id}-line`}
                    x1="50"
                    y1="50"
                    x2="50"
                    y2="0"
                    transform={`rotate(${i * sliceDegrees} 50 50)`}
                    strokeWidth="0.8"
                    className="stroke-game-surface"
                  />
                ))}
              {segments.map((segment, i) => {
                const label = shortLabel(segment.name);
                const size = Math.min(baseLabelSize, LABEL_MAX_LENGTH / (Math.max(1, label.length) * 0.62));
                return (
                  <text
                    key={`${segment.id}-label`}
                    x="50"
                    y={LABEL_OFFSET}
                    transform={`rotate(${i * sliceDegrees + sliceDegrees / 2} 50 50) rotate(-90 50 ${LABEL_OFFSET})`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={size}
                    fontWeight={700}
                    strokeWidth={size * 0.3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    className="fill-game-surface stroke-game-text"
                  >
                    {label}
                  </text>
                );
              })}
            </svg>
          </div>
          {/* Centro da roda. */}
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 flex size-[17%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-game-primary bg-game-surface shadow-(--game-elevation-md)"
          >
            <span className="size-[38%] rounded-full bg-game-primary" />
          </div>
          {/* Ponteiro, por cima do aro. */}
          <div
            aria-hidden="true"
            className={cn("absolute left-1/2 top-0 w-[11%] -translate-x-1/2 -translate-y-[38%]", styles.pointer, result && styles.pointerSettle)}
          >
            <svg viewBox="0 0 40 52" className="block w-full">
              <path
                d="M9 3 H31 Q37 3 35 9 L23.5 46 Q20 53 16.5 46 L5 9 Q3 3 9 3 Z"
                strokeWidth="3"
                strokeLinejoin="round"
                className="fill-game-surface stroke-game-primary"
              />
              <circle cx="20" cy="13" r="4.5" className="fill-game-primary" />
            </svg>
          </div>
        </div>

        {!result && (
          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning}
            aria-busy={spinning || undefined}
            className={gameButtonClass({ size: "xl", className: "w-full disabled:cursor-progress sm:w-auto sm:min-w-64" })}
          >
            {spinning ? <Spinner /> : <RotateCw aria-hidden="true" className="size-5 shrink-0" />}
            {spinning ? "A rodar…" : "Rodar a roda"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-game border border-game-danger bg-game-surface px-3 py-2 text-sm text-game-danger"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/*
        A região viva está sempre montada: um aria-live que aparece ao mesmo
        tempo que o texto costuma não ser anunciado pelos leitores de ecrã.
      */}
      <div aria-live="polite" className="w-full">
        {result && (
          <div
            className={cn(
              "relative isolate overflow-hidden px-6 py-8 text-center sm:px-10",
              gameCardClass,
              "motion-safe:animate-scale-in",
            )}
          >
            {result.outcome === "WIN" && <Burst className="top-15" />}
            <ResultBadge tone={result.outcome === "WIN" ? "win" : "neutral"}>
              {result.outcome === "WIN" ? <Gift className="size-7" /> : <Sparkles className="size-7" />}
            </ResultBadge>
            <p className="text-balance text-2xl font-bold tracking-tight text-game-text sm:text-3xl">
              {result.outcome === "WIN" ? "Parabéns, ganhou!" : "Não foi desta vez"}
            </p>
            {result.prize && (
              <p className="mx-auto mt-4 w-fit max-w-full rounded-game bg-game-highlight px-4 py-2 text-lg font-bold text-game-highlight-text">
                {result.prize.publicName}
              </p>
            )}
            {result.prize?.code && (
              <p className="mx-auto mt-3 w-fit max-w-full select-all break-all rounded-game border-2 border-dashed border-game-border-strong px-4 py-1.5 font-mono text-base font-bold tracking-[0.12em] text-game-text">
                {result.prize.code}
              </p>
            )}
            {result.prizePending && (
              <p className="mx-auto mt-3 max-w-sm text-pretty leading-relaxed text-game-muted">
                {result.prize
                  ? "Preencha os seus dados a seguir para receber o código."
                  : "Preencha os seus dados a seguir para receber o prémio."}
              </p>
            )}
            {result.prizeUnavailable && (
              <p className="mx-auto mt-3 max-w-sm text-pretty leading-relaxed text-game-muted">
                O prémio já não pode ser atribuído a esta participação.
              </p>
            )}
            {result.message && <p className="mx-auto mt-3 max-w-sm text-pretty text-sm text-game-muted">{result.message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
