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
        <p className="mb-3 text-center text-sm text-caetano-medium-gray" aria-live="polite">
          Memorize as cartas…
        </p>
      )}
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))`,
          gap: `${config.cardGapPx}px`,
        }}
      >
        {tiles.map((tile) => {
          const faceUp = isFaceUp(tile);
          return (
            <button
              key={tile.tileId}
              type="button"
              onClick={() => handleFlip(tile)}
              disabled={faceUp || finished}
              aria-label={faceUp ? tile.alt ?? tile.text ?? "Carta revelada" : "Carta virada para baixo"}
              className={cn(
                "flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-caetano-medium-gray/30 bg-white p-1 transition-transform",
                matched.has(tile.pairId) && "opacity-60",
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

      <div className="mt-4 flex justify-center gap-6 text-sm text-caetano-medium-gray" aria-live="polite">
        <span>Tentativas: {attempts}</span>
        <span>Tempo: {timeSeconds}s</span>
        <span>
          Pares: {matched.size}/{pairs.length}
        </span>
      </div>
    </div>
  );
}
