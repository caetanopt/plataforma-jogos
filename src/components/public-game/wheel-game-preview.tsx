"use client";

import { WheelGamePlayer, type WheelPlayerSegment, type WheelSpinResult } from "@/components/public-game/wheel-game-player";

interface PreviewSegment extends WheelPlayerSegment {
  weight: number;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prizeName: string | null;
}

/** Simulação local (só para pré-visualização no editor, nunca no jogo público real). */
function simulateSpin(segments: PreviewSegment[]): WheelSpinResult {
  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
  let roll = Math.random() * totalWeight;
  const chosen = segments.find((s) => {
    if (roll < s.weight) return true;
    roll -= s.weight;
    return false;
  }) ?? segments[segments.length - 1];

  return {
    segmentId: chosen.id,
    segmentName: chosen.name,
    outcome: chosen.outcome,
    message: chosen.message,
    prize: chosen.prizeName ? { id: chosen.id, publicName: chosen.prizeName, instructions: null, code: "PREVIEW" } : null,
  };
}

export function WheelGamePreview({ segments }: { segments: PreviewSegment[] }) {
  if (segments.length === 0) {
    return (
      <p className="text-sm text-caetano-medium-gray">
        Adicione pelo menos um segmento para pré-visualizar a roda.
      </p>
    );
  }

  return (
    <WheelGamePlayer
      segments={segments}
      onSpin={() => new Promise((resolve) => setTimeout(() => resolve(simulateSpin(segments)), 300))}
    />
  );
}
