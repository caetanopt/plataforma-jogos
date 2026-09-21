"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { shuffle } from "@/lib/random/shuffle";
import { cn } from "@/lib/utils";

export interface MemoryPlayerPair {
  id: string;
  cardAMediaUrl?: string | null;
  cardAText?: string | null;
  cardAAlt?: string | null;
  cardBMediaUrl?: string | null;
  cardBText?: string | null;
  cardBAlt?: string | null;
}

export interface MemoryPlayerConfig {
  columns: number;
  randomizeOrder: boolean;
  cardGapPx: number;
  timeLimitSeconds: number | null;
  maxAttempts: number | null;
  previewSeconds: number | null;
  cardBackUrl?: string | null;
}

interface Tile {
  tileId: string;
  pairId: string;
  mediaUrl?: string | null;
  text?: string | null;
  alt?: string | null;
}

interface MemoryGamePlayerProps {
  pairs: MemoryPlayerPair[];
  config: MemoryPlayerConfig;
  onComplete: (result: { attempts: number; pairsFound: number; timeSeconds: number }) => void;
}

function buildTiles(pairs: MemoryPlayerPair[]): Tile[] {
  return pairs.flatMap((pair) => [
    {
      tileId: `${pair.id}-a`,
      pairId: pair.id,
      mediaUrl: pair.cardAMediaUrl,
      text: pair.cardAText,
      alt: pair.cardAAlt,
    },
    {
      tileId: `${pair.id}-b`,
      pairId: pair.id,
      mediaUrl: pair.cardBMediaUrl,
      text: pair.cardBText,
      alt: pair.cardBAlt,
    },
  ]);
}

export function MemoryGamePlayer({ pairs, config, onComplete }: MemoryGamePlayerProps) {
  const tiles = useMemo(() => {
    const built = buildTiles(pairs);
    return config.randomizeOrder ? shuffle(built) : built;
  }, [pairs, config.randomizeOrder]);

  const [revealed, setRevealed] = useState<string[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [attempts, setAttempts] = useState(0);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [previewing, setPreviewing] = useState((config.previewSeconds ?? 0) > 0);
  const busyRef = useRef(false);
  const completionReportedRef = useRef(false);

  const finished =
    (pairs.length > 0 && matched.size === pairs.length) ||
    (config.timeLimitSeconds != null && timeSeconds >= config.timeLimitSeconds) ||
    (config.maxAttempts != null && attempts >= config.maxAttempts);

  useEffect(() => {
    if (!previewing) return;
    const timeout = setTimeout(() => setPreviewing(false), (config.previewSeconds ?? 0) * 1000);
    return () => clearTimeout(timeout);
  }, [previewing, config.previewSeconds]);

  useEffect(() => {
    if (previewing || finished) return;
    const interval = setInterval(() => setTimeSeconds((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [previewing, finished]);

  useEffect(() => {
    if (finished && !completionReportedRef.current) {
      completionReportedRef.current = true;
      onComplete({ attempts, pairsFound: matched.size, timeSeconds });
    }
  }, [finished, attempts, matched, timeSeconds, onComplete]);

  function handleFlip(tile: Tile) {
    // Substitui o `disabled` do botão: ver o comentário no JSX.
    if (finished || isFaceUp(tile)) return;
    if (previewing || finished || busyRef.current) return;
    if (revealed.includes(tile.tileId) || matched.has(tile.pairId)) return;

    const nextRevealed = [...revealed, tile.tileId];
    setRevealed(nextRevealed);

    if (nextRevealed.length === 2) {
      busyRef.current = true;
      setAttempts((a) => a + 1);
      const [firstId, secondId] = nextRevealed;
      const firstTile = tiles.find((t) => t.tileId === firstId);
      const secondTile = tiles.find((t) => t.tileId === secondId);
      const isMatch = firstTile && secondTile && firstTile.pairId === secondTile.pairId;

      setTimeout(() => {
        if (isMatch && firstTile) {
          setMatched((prev) => new Set(prev).add(firstTile.pairId));
        }
        setRevealed([]);
        busyRef.current = false;
      }, 700);
    }
  }

  const isFaceUp = (tile: Tile) => previewing || revealed.includes(tile.tileId) || matched.has(tile.pairId);

  return (
    <div>
      {previewing && (
        <p className="mb-3 text-center text-sm text-caetano-anthracite-80" aria-live="polite">
          Memorize as cartas…
        </p>
      )}
      <div
        className="memory-grid"
        style={
          {
            "--memory-columns": config.columns,
            gap: `${config.cardGapPx}px`,
          } as React.CSSProperties
        }
      >
        {tiles.map((tile, position) => {
          const faceUp = isFaceUp(tile);
          const isMatched = matched.has(tile.pairId);
          const locked = faceUp || finished;
          return (
            <button
              key={tile.tileId}
              type="button"
              onClick={() => handleFlip(tile)}
              // `disabled` tirava o foco do teclado a cada jogada, atirando o
              // utilizador para o início da grelha. `aria-disabled` comunica o
              // mesmo e a guarda está no handler.
              aria-disabled={locked || undefined}
              aria-pressed={faceUp}
              aria-label={`Carta ${position + 1} de ${tiles.length}: ${
                faceUp ? tile.alt ?? tile.text ?? "revelada" : "virada para baixo"
              }${isMatched ? ", par encontrado" : ""}`}
              className={cn(
                "flex aspect-square cursor-pointer touch-manipulation items-center justify-center overflow-hidden rounded-lg border border-caetano-medium-gray-40 bg-white p-1",
                "transition-[transform,border-color] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2",
                !locked && "motion-safe:active:scale-[0.96]",
                // Tom oficial em vez de opacidade, que deixa de ser cor da
                // paleta assim que o fundo não é branco.
                isMatched && "border-caetano-eco-green-40 bg-caetano-eco-green-20",
                locked && "cursor-default",
              )}
            >
              {faceUp ? (
                tile.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tile.mediaUrl} alt={tile.alt ?? ""} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-center text-sm font-medium text-caetano-anthracite">
                    {tile.text}
                  </span>
                )
              ) : config.cardBackUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.cardBackUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="h-full w-full rounded-lg bg-caetano-deep-blue" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex justify-center gap-6 text-sm text-caetano-anthracite-80">
        {/*
          O tempo muda a cada segundo: dentro de um aria-live fazia o leitor de
          ecrã falar sem parar. Fica fora; o que é anunciado são as tentativas
          e os pares, que só mudam quando o jogador joga.
        */}
        <span aria-live="polite">Tentativas: {attempts}</span>
        <span aria-hidden="true">Tempo: {timeSeconds}s</span>
        <span aria-live="polite">
          Pares: {matched.size}/{pairs.length}
        </span>
      </div>
    </div>
  );
}
