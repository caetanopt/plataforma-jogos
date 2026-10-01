"use client";

import { useState } from "react";
import { CircleAlert, Hourglass, RotateCcw, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Burst, ForwardArrow, gameButtonClass, gameCardClass, ResultBadge, Spinner } from "@/components/public-game/game-ui";
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
      <div
        className={cn(
          "flex items-center justify-center gap-3 px-6 py-10 text-center text-sm font-medium text-game-muted motion-safe:animate-fade-in",
          gameCardClass,
        )}
      >
        <Spinner className="size-5 text-game-accent" />
        A calcular o resultado…
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className={cn("p-6 text-center sm:p-8", gameCardClass, "motion-safe:animate-scale-in")}>
        <p
          className="flex items-start justify-center gap-2 text-sm text-game-danger"
          role="alert"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          Não foi possível calcular o resultado. Tente novamente.
        </p>
        <button
          type="button"
          onClick={() => lastRaw && handleComplete(lastRaw)}
          className={gameButtonClass({ size: "lg", className: "mt-5 w-full" })}
        >
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (phase === "done" && result) {
    return (
      <div className="space-y-4">
        <div
          className={cn(
            "relative isolate overflow-hidden px-6 py-9 text-center sm:px-10",
            gameCardClass,
            "motion-safe:animate-scale-in",
          )}
          aria-live="polite"
        >
          {result.completed && <Burst className="top-16" />}
          <ResultBadge tone={result.completed ? "win" : "neutral"}>
            {result.completed ? <Trophy className="size-7" /> : <Hourglass className="size-7" />}
          </ResultBadge>
          <p className="text-balance text-2xl font-bold tracking-tight text-game-text sm:text-3xl">
            {result.completed ? "Jogo concluído!" : "Tempo esgotado"}
          </p>
          <p className="mt-4 text-game-muted">
            <span className="block text-xs font-medium uppercase tracking-[0.14em]">
              Pontuação<span className="sr-only">:</span>
            </span>{" "}
            <span className="mt-1 block text-5xl font-bold tabular-nums tracking-tight text-game-text">
              {result.score}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onContinue}
          className={gameButtonClass({ size: "lg", className: "group w-full" })}
        >
          Continuar
          <ForwardArrow />
        </button>
      </div>
    );
  }

  return <MemoryGamePlayer pairs={pairs} config={config} onComplete={handleComplete} />;
}
