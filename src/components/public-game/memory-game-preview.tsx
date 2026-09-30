"use client";

import { useState } from "react";
import { MemoryGamePlayer, type MemoryPlayerConfig, type MemoryPlayerPair } from "@/components/public-game/memory-game-player";
import { computeMemoryScore, type MemoryScoringConfig } from "@/features/memory-game/scoring";

export function MemoryGamePreview({
  pairs,
  config,
  scoringConfig,
}: {
  pairs: MemoryPlayerPair[];
  config: MemoryPlayerConfig;
  scoringConfig: MemoryScoringConfig;
}) {
  const [result, setResult] = useState<{ attempts: number; pairsFound: number; timeSeconds: number } | null>(
    null,
  );

  if (pairs.length === 0) {
    return (
      <p className="text-sm text-game-muted">
        Adicione pelo menos um par de cartas para pré-visualizar o jogo.
      </p>
    );
  }

  if (result) {
    const score = computeMemoryScore({
      pairsTotal: pairs.length,
      pairsFound: result.pairsFound,
      attempts: result.attempts,
      timeSeconds: result.timeSeconds,
      config: scoringConfig,
    });
    return (
      <div className="rounded-game-lg border border-game-border bg-game-surface shadow-(--game-shadow) p-6 text-center">
        <p className="text-lg font-bold text-game-text">
          {score.completed ? "Jogo concluído!" : "Simulação terminada"}
        </p>
        <p className="mt-2 text-game-muted">
          Pontuação: {score.score} · Tentativas: {result.attempts} · Tempo: {result.timeSeconds}s
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className="mt-4 rounded-game border border-game-border-strong px-4 py-2 text-sm text-game-text hover:bg-game-subtle"
        >
          Jogar novamente
        </button>
      </div>
    );
  }

  return <MemoryGamePlayer pairs={pairs} config={config} onComplete={setResult} />;
}
