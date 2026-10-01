"use client";

import { useState } from "react";
import { Hourglass, Layers, RotateCcw, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Burst, gameButtonClass, gameCardClass, PreviewEmpty, ResultBadge } from "@/components/public-game/game-ui";
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
      <PreviewEmpty icon={<Layers className="size-6" />}>
        Adicione pelo menos um par de cartas para pré-visualizar o jogo.
      </PreviewEmpty>
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
      <div className={cn("relative isolate overflow-hidden px-6 py-9 text-center", gameCardClass, "motion-safe:animate-scale-in")}>
        {score.completed && <Burst className="top-16" />}
        <ResultBadge tone={score.completed ? "win" : "neutral"}>
          {score.completed ? <Trophy className="size-7" /> : <Hourglass className="size-7" />}
        </ResultBadge>
        <p className="text-balance text-2xl font-bold tracking-tight text-game-text">
          {score.completed ? "Jogo concluído!" : "Simulação terminada"}
        </p>
        <p className="mt-2 text-sm tabular-nums text-game-muted">
          Pontuação: {score.score} · Tentativas: {result.attempts} · Tempo: {result.timeSeconds}s
        </p>
        <button
          type="button"
          onClick={() => setResult(null)}
          className={gameButtonClass({ variant: "secondary", size: "md", className: "mt-6" })}
        >
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          Jogar novamente
        </button>
      </div>
    );
  }

  return <MemoryGamePlayer pairs={pairs} config={config} onComplete={setResult} />;
}
