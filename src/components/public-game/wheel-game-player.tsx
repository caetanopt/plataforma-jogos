"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface WheelPlayerSegment {
  id: string;
  name: string;
  colorHex: string;
}

export interface WheelSpinResult {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: { id: string; publicName: string; instructions: string | null; code: string | null } | null;
}

interface WheelGamePlayerProps {
  segments: WheelPlayerSegment[];
  onSpin: () => Promise<WheelSpinResult>;
  /** Disparado quando o resultado fica visível, não quando o servidor responde. */
  onResultRevealed?: () => void;
}

const EXTRA_SPINS = 5;
const SPIN_DURATION_MS = 4000;

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
    <div className="flex flex-col items-center gap-6">
      {/*
        A roda acompanha a largura disponível em vez de ficar presa a 288 px,
        que transbordava em ecrãs estreitos.
      */}
      <div className="relative aspect-square w-full max-w-72">
        <div
          className="absolute inset-0 rounded-full border-4 border-caetano-deep-blue"
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
        />
        <div
          className="absolute left-1/2 top-0 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-caetano-anthracite"
          aria-hidden="true"
        />
      </div>

      {!result && (
        <button
          type="button"
          onClick={handleSpin}
          disabled={spinning}
          aria-busy={spinning || undefined}
          className={cn(
            "cursor-pointer touch-manipulation select-none rounded-full bg-caetano-deep-blue px-8 py-3 font-bold text-white",
            "transition-[background-color,transform] duration-150 motion-safe:active:scale-[0.97]",
            "hover:bg-caetano-deep-blue-80 active:bg-caetano-deep-blue",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2",
            "disabled:cursor-progress disabled:opacity-60",
          )}
        >
          {spinning ? "A rodar…" : "Rodar a roda"}
        </button>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger-strong">
          {error}
        </p>
      )}

      {/*
        A região viva está sempre montada: um aria-live que aparece ao mesmo
        tempo que o texto costuma não ser anunciado pelos leitores de ecrã.
      */}
      <div aria-live="polite" className="w-full">
        {result && (
          <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6 text-center">
            <p className="text-lg font-bold text-caetano-anthracite">
              {result.outcome === "WIN" ? "Parabéns, ganhou!" : "Não foi desta vez"}
            </p>
            {result.prize && <p className="mt-1 text-caetano-anthracite-80">{result.prize.publicName}</p>}
            {result.prize?.code && <p className="mt-1 font-mono text-sm">{result.prize.code}</p>}
            {result.message && <p className="mt-2 text-sm text-caetano-anthracite-80">{result.message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
