"use client";

import { useState } from "react";
import { WheelGamePlayer, type WheelPlayerSegment, type WheelSpinResult } from "@/components/public-game/wheel-game-player";

export function PublicWheelGame({
  segments,
  onSpin,
  onContinue,
}: {
  segments: WheelPlayerSegment[];
  onSpin: () => Promise<WheelSpinResult>;
  onContinue: () => void;
}) {
  const [resultReady, setResultReady] = useState(false);

  async function handleSpin() {
    const result = await onSpin();
    setResultReady(true);
    return result;
  }

  return (
    <div className="space-y-4">
      <WheelGamePlayer segments={segments} onSpin={handleSpin} />
      {resultReady && (
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white"
        >
          Continuar
        </button>
      )}
    </div>
  );
}
