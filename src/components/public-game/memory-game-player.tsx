"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye } from "lucide-react";
import { shuffle } from "@/lib/random/shuffle";
import { cn } from "@/lib/utils";
import styles from "@/components/public-game/public-game.module.css";

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
        <p
          className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-game-border bg-game-surface px-4 py-2 text-center text-sm font-medium text-game-text shadow-(--game-elevation-md) motion-safe:animate-fade-in"
          aria-live="polite"
        >
          <Eye aria-hidden="true" className="size-4 shrink-0 text-game-accent" />
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
                "relative aspect-square cursor-pointer touch-manipulation rounded-game",
                "transition-[translate,scale,box-shadow] duration-200 ease-(--ease-out-expo)",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2 focus-visible:ring-offset-game-surface",
                "shadow-(--game-elevation-sm)",
                !locked &&
                  "hover:shadow-(--game-elevation-md) motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.96]",
                isMatched && styles.matchPop,
                locked && "cursor-default",
              )}
            >
              {/*
                Vira em 3D: cada face roda sobre si (de costas, fica escondida).
                A face à vista não tem transformação nenhuma, para o texto
                ficar nítido. Com movimento reduzido não há rotação: mostra-se
                só a face certa.
              */}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-0 overflow-hidden rounded-game backface-hidden transition-transform duration-500 ease-(--ease-out-expo)",
                  !config.cardBackUrl && styles.cardBack,
                  faceUp && "motion-safe:[transform:perspective(700px)_rotateY(-180deg)] motion-reduce:invisible",
                )}
              >
                {config.cardBackUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={config.cardBackUrl} alt="" className="h-full w-full object-cover" />
                )}
              </span>
              <span
                className={cn(
                  "absolute inset-0 flex items-center justify-center overflow-hidden rounded-game border p-1.5 backface-hidden",
                  "transition-[transform,background-color,border-color] duration-500 ease-(--ease-out-expo)",
                  isMatched
                    ? // Tom do verde eco sobre o fundo do tema, com texto que se lê
                      // nele (num tema Caetano, os tons oficiais -40 e -20).
                      "border-game-success-border bg-game-success-tint text-game-success-text"
                    : "border-game-border bg-game-surface text-game-text",
                  !faceUp && "motion-safe:[transform:perspective(700px)_rotateY(180deg)] motion-reduce:invisible",
                )}
              >
                {/*
                  A face fica montada para se ver enquanto a carta volta a
                  fechar, mas escondida (fora da pesquisa da página e dos
                  leitores de ecrã) assim que fica de costas.
                */}
                <span
                  className={cn(
                    "flex h-full w-full items-center justify-center transition-[visibility] duration-0",
                    faceUp ? "visible delay-0" : "invisible delay-300 motion-reduce:delay-0",
                  )}
                >
                  {tile.mediaUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={tile.mediaUrl} alt={tile.alt ?? ""} className="h-full w-full rounded-[inherit] object-contain" />
                  ) : (
                    <span
                      lang="pt"
                      // Nas cartas estreitas (telemóvel de 320 px) a palavra
                      // parte-se em vez de sair da carta.
                      className={cn(
                        "min-w-0 max-w-full hyphens-auto wrap-anywhere text-center text-[0.6875rem] font-medium leading-tight min-[400px]:text-xs sm:text-sm",
                        isMatched ? "text-game-success-text" : "text-game-text",
                      )}
                    >
                      {tile.text}
                    </span>
                  )}
                </span>
                {isMatched && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-game-success-border text-game-success-text motion-safe:animate-scale-in sm:right-1.5 sm:top-1.5 sm:size-5"
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mx-auto mt-5 grid w-full max-w-md grid-cols-3 divide-x divide-game-border rounded-full border border-game-border bg-game-surface py-2 text-center text-xs font-medium tabular-nums text-game-text shadow-(--game-elevation-sm) sm:text-sm">
        {/*
          O tempo muda a cada segundo: dentro de um aria-live fazia o leitor de
          ecrã falar sem parar. Fica fora; o que é anunciado são as tentativas
          e os pares, que só mudam quando o jogador joga.
        */}
        <span aria-live="polite" className="px-2">
          Tentativas: {attempts}
        </span>
        <span aria-hidden="true" className="px-2">
          Tempo: {timeSeconds}s
        </span>
        <span aria-live="polite" className="px-2">
          Pares: {matched.size}/{pairs.length}
        </span>
      </div>
    </div>
  );
}
