"use client";

import { useState } from "react";
import { ForwardArrow, gameButtonClass } from "@/components/public-game/game-ui";
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
          className={gameButtonClass({ size: "lg", className: "group w-full motion-safe:animate-enter" })}
        >
          Continuar
          <ForwardArrow />
        </button>
      )}
    </div>
  );
}
