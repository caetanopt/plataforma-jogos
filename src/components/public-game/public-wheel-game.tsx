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

  return (
    <div className="space-y-4">
      {/*
        O "Continuar" aparecia assim que o servidor respondia, ou seja, com a
        roda ainda a girar: dava para saltar a revelação do próprio resultado.
        Agora espera pelo momento em que o resultado fica mesmo visível.
      */}
      <WheelGamePlayer segments={segments} onSpin={onSpin} onResultRevealed={() => setResultReady(true)} />
      {resultReady && (
        <button
          type="button"
          onClick={onContinue}
          className="w-full cursor-pointer touch-manipulation select-none rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white transition-[background-color,transform] duration-150 hover:bg-caetano-deep-blue-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2 active:bg-caetano-deep-blue motion-safe:active:scale-[0.99]"
        >
          Continuar
        </button>
      )}
    </div>
  );
}
