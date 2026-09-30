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

  // As imagens das cartas só começavam a descarregar quando a carta virava
  // (e voltava a fechar aos 700 ms): num telemóvel, via-se a carta vazia.
  // Pré-carregadas ao abrir o tabuleiro, estão prontas quando viram.
  useEffect(() => {
    const urls = new Set(pairs.flatMap((pair) => [pair.cardAMediaUrl, pair.cardBMediaUrl]).filter(Boolean));
    const images = [...urls].map((url) => {
      const image = new Image();
      image.decoding = "async";
      image.src = url as string;
      return image;
    });
    return () => {
      for (const image of images) image.src = "";
    };
  }, [pairs]);

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
        // Com fundo próprio: pode estar sobre a imagem de fundo do tema.
        <p className="mx-auto mb-3 w-fit rounded-game bg-game-surface px-3 py-1 text-center text-sm text-game-muted" aria-live="polite">
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
                "flex aspect-square cursor-pointer touch-manipulation items-center justify-center overflow-hidden rounded-game border border-game-border bg-game-surface p-1",
                "transition-[transform,border-color] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2",
                !locked && "motion-safe:active:scale-[0.96]",
                // Tom do verde eco sobre o fundo do tema, com texto que se lê
                // nele (num tema Caetano, os tons oficiais -40 e -20).
                isMatched && "border-game-success-border bg-game-success-tint text-game-success-text",
                locked && "cursor-default",
              )}
            >
              {faceUp ? (
                tile.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tile.mediaUrl} alt={tile.alt ?? ""} className="h-full w-full object-contain" />
                ) : (
                  <span className={cn("text-center text-sm font-medium", isMatched ? "text-game-success-text" : "text-game-text")}>
                    {tile.text}
                  </span>
                )
              ) : config.cardBackUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={config.cardBackUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="h-full w-full rounded-game bg-game-primary" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mx-auto mt-4 flex w-fit flex-wrap justify-center gap-x-6 gap-y-1 rounded-game bg-game-surface px-4 py-1.5 text-sm text-game-muted">
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
