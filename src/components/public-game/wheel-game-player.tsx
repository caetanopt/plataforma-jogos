"use client";

import { useState } from "react";
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
}

const EXTRA_SPINS = 5;

export function WheelGamePlayer({ segments, onSpin }: WheelGamePlayerProps) {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelSpinResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sliceDegrees = 360 / Math.max(1, segments.length);

  async function handleSpin() {
    if (spinning || result) return;
    setSpinning(true);
    setError(null);
    try {
      const spinResult = await onSpin();
      const targetIndex = segments.findIndex((s) => s.id === spinResult.segmentId);
      const landingIndex = targetIndex >= 0 ? targetIndex : 0;
      const sliceCenter = landingIndex * sliceDegrees + sliceDegrees / 2;
      const targetRotation = 360 * EXTRA_SPINS - sliceCenter;
      setRotation(targetRotation);
      setTimeout(() => {
        setResult(spinResult);
        setSpinning(false);
      }, 4000);
    } catch {
      setError("Não foi possível determinar o resultado. Tente novamente.");
      setSpinning(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative h-72 w-72">
        <div
          className="absolute inset-0 rounded-full border-4 border-caetano-deep-blue motion-reduce:transition-none"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: spinning ? "transform 4s cubic-bezier(0.2, 0.8, 0.2, 1)" : undefined,
            background: `conic-gradient(${segments
              .map((s, i) => `${s.colorHex} ${i * sliceDegrees}deg ${(i + 1) * sliceDegrees}deg`)
              .join(", ")})`,
          }}
          role="img"
          aria-label={`Roda com ${segments.length} segmentos`}
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
          className={cn(
            "rounded-full bg-caetano-deep-blue px-8 py-3 font-semibold text-white transition-opacity",
            spinning && "opacity-60",
          )}
        >
          {spinning ? "A rodar…" : "Rodar a roda"}
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6 text-center" aria-live="polite">
          <p className="text-lg font-semibold text-caetano-anthracite">
            {result.outcome === "WIN" ? "Parabéns, ganhou!" : "Não foi desta vez"}
          </p>
          {result.prize && <p className="mt-1 text-caetano-medium-gray">{result.prize.publicName}</p>}
          {result.prize?.code && <p className="mt-1 font-mono text-sm">{result.prize.code}</p>}
          {result.message && <p className="mt-2 text-sm text-caetano-medium-gray">{result.message}</p>}
        </div>
      )}
    </div>
  );
}
