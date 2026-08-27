"use client";

import { useState } from "react";
import { MemoryGamePlayer, type MemoryPlayerConfig, type MemoryPlayerPair } from "@/components/public-game/memory-game-player";

export function PublicMemoryGame({
  pairs,
  config,
  onSubmit,
  onContinue,
}: {
  pairs: MemoryPlayerPair[];
  config: MemoryPlayerConfig;
  onSubmit: (result: { attempts: number; pairsFound: number; timeSeconds: number }) => Promise<{
    score: number;
    completed: boolean;
  }>;
  onContinue: () => void;
}) {
  const [phase, setPhase] = useState<"playing" | "submitting" | "done" | "error">("playing");
  const [result, setResult] = useState<{ score: number; completed: boolean } | null>(null);
  const [lastRaw, setLastRaw] = useState<{ attempts: number; pairsFound: number; timeSeconds: number } | null>(null);

  function handleComplete(raw: { attempts: number; pairsFound: number; timeSeconds: number }) {
    setLastRaw(raw);
    setPhase("submitting");
    onSubmit(raw)
      .then((r) => {
        setResult(r);
        setPhase("done");
      })
      .catch((error: unknown) => {
        console.error("[memory] Falha ao submeter o resultado do jogo:", error);
        setPhase("error");
      });
  }

  if (phase === "submitting") {
    return (
      <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6 text-center text-sm text-caetano-medium-gray">
        A calcular o resultado…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6 text-center">
        <p className="text-sm text-red-600" role="alert">
          Não foi possível calcular o resultado. Tente novamente.
        </p>
        <button
          type="button"
          onClick={() => lastRaw && handleComplete(lastRaw)}
          className="mt-4 w-full rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-6 text-center" aria-live="polite">
          <p className="text-lg font-semibold text-caetano-anthracite">
            {result.completed ? "Jogo concluído!" : "Tempo esgotado"}
          </p>
          <p className="mt-1 text-caetano-medium-gray">Pontuação: {result.score}</p>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white"
        >
          Continuar
        </button>
      </div>
    );
  }

  return <MemoryGamePlayer pairs={pairs} config={config} onComplete={handleComplete} />;
}
