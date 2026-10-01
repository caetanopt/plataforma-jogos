import type { CSSProperties, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "@/components/public-game/public-game.module.css";

/*
  Peças visuais partilhadas pelo jogo público. Só tokens do tema da campanha
  (bg-game-*, text-game-*, rounded-game, --game-elevation-*): nunca cores da
  Caetano, que estragavam as outras marcas. O movimento é todo `motion-safe:`.
*/

/** Cartão do jogo: a superfície do tema, uma linha fina e a elevação do tema. */
export const gameCardClass =
  "rounded-game-lg border border-game-border bg-game-surface text-game-text shadow-(--game-elevation-lg)";

/** Entrada de cada etapa (início, formulário, ecrãs, jogo, resultado). */
export const stageEnterClass = "motion-safe:animate-enter";

type GameButtonVariant = "primary" | "secondary";
type GameButtonSize = "md" | "lg" | "xl";

const buttonBase = cn(
  "inline-flex cursor-pointer touch-manipulation select-none items-center justify-center gap-2 rounded-game text-center",
  "transition-[background-color,border-color,color,box-shadow,translate,scale] duration-200 ease-(--ease-out-expo)",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2 focus-visible:ring-offset-game-surface",
  // O afundar e o subir são movimento: ficam fora com movimento reduzido.
  "motion-safe:active:scale-[0.97]",
  "disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none",
  // A trabalhar (a preparar, a enviar, a rodar): o botão fica na cor plena,
  // com o indicador e o texto do estado, em vez de parecer desativado.
  "aria-busy:cursor-progress aria-busy:opacity-100",
);

const buttonVariants: Record<GameButtonVariant, string> = {
  // O hover do tema é o tom claro da cor do botão (o texto continua legível).
  primary: cn(
    "bg-game-button font-bold text-game-button-text shadow-(--game-elevation-sm)",
    "not-disabled:hover:bg-game-button-hover not-disabled:hover:shadow-(--game-elevation-md) active:bg-game-button",
    "motion-safe:not-disabled:hover:-translate-y-0.5 motion-safe:active:translate-y-0",
  ),
  secondary: cn(
    "border border-game-border-strong bg-game-surface font-medium text-game-text",
    "not-disabled:hover:border-game-accent not-disabled:hover:bg-game-subtle not-disabled:hover:text-game-subtle-text active:bg-game-subtle",
  ),
};

const buttonSizes: Record<GameButtonSize, string> = {
  md: "min-h-11 px-5 py-2 text-sm",
  lg: "min-h-12 px-6 py-2.5 text-base",
  xl: "min-h-14 px-8 py-3 text-base sm:text-lg",
};

export function gameButtonClass({
  variant = "primary",
  size = "lg",
  className,
}: { variant?: GameButtonVariant; size?: GameButtonSize; className?: string } = {}): string {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

/** Link de texto no tema (CTA secundária, ações discretas). */
export const gameLinkClass = cn(
  "inline-flex min-h-6 items-center gap-1.5 rounded-sm font-medium text-game-accent underline decoration-1 underline-offset-4",
  "transition-[text-decoration-color,color] duration-150 hover:decoration-2",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent focus-visible:ring-offset-2 focus-visible:ring-offset-game-surface",
);

/** Seta de avançar, que se adianta quando o botão (com `group`) está sob o rato. */
export function ForwardArrow({ className }: { className?: string }) {
  return (
    <ArrowRight
      aria-hidden="true"
      className={cn(
        "size-5 shrink-0 transition-[translate] duration-200 ease-(--ease-out-expo) motion-safe:group-hover:translate-x-1",
        className,
      )}
    />
  );
}

/** Indicador de carregamento dentro de um botão; o texto do botão diz o estado. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-4 shrink-0 rounded-full border-2 border-current border-r-transparent motion-safe:animate-spin motion-reduce:hidden",
        className,
      )}
    />
  );
}

/**
 * Cabeçalho de marca de um ecrã: a cor dos botões com a luz da secundária
 * e o texto que o tema garante legível sobre ela. Decorado, nunca com
 * controlos lá dentro.
 */
export function BrandHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative isolate overflow-hidden", styles.brandSurface, className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className={styles.aurora} />
      </div>
      {children}
    </div>
  );
}

/** Selo redondo com um ícone, no topo de um resultado. */
export function ResultBadge({ tone, children }: { tone: "win" | "neutral"; children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-auto mb-4 flex size-14 items-center justify-center rounded-full motion-safe:animate-scale-in",
        tone === "win"
          ? "bg-game-button text-game-button-text shadow-(--game-elevation-md)"
          : "bg-game-subtle text-game-subtle-text",
      )}
    >
      {children}
    </span>
  );
}

/** Pré-visualização sem conteúdo ainda (editor): o que falta para ver o jogo. */
export function PreviewEmpty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-game-lg border border-dashed border-game-border-strong bg-game-surface px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-game-subtle text-game-subtle-text"
      >
        {icon}
      </span>
      <p className="max-w-xs text-pretty text-sm text-game-muted">{children}</p>
    </div>
  );
}

// Peças da explosão: direção, distância, rotação e cor (por ordem do tema).
const BURST_PIECES = Array.from({ length: 18 }, (_, index) => ({
  angle: Math.round((360 / 18) * index + (index % 2 ? 7 : -5)),
  distance: 58 + ((index * 29) % 46),
  spin: (index % 2 ? 1 : -1) * (160 + ((index * 53) % 200)),
  delay: (index % 3) * 40,
  shape: index % 3 === 0 ? "dot" : "piece",
}));

const BURST_COLORS = {
  // Sobre a superfície do cartão.
  surface: [
    "var(--game-primary)",
    "var(--game-glow)",
    "var(--game-accent)",
    "var(--game-success-border)",
    "var(--game-highlight)",
    "var(--game-button)",
  ],
  // Sobre o tom de destaque (talão do prémio).
  highlight: [
    "var(--game-primary)",
    "var(--game-surface)",
    "var(--game-glow)",
    "var(--game-success-border)",
    "var(--game-accent)",
  ],
} as const;

/**
 * Confettis de celebração, só CSS e nas cores do tema. Decorativos
 * (aria-hidden) e desligados com movimento reduzido (public-game.module.css).
 * O contentor tem de ser `relative`; com `isolate`, a explosão passa por
 * baixo do texto (-z-10) e por cima do fundo do cartão.
 */
export function Burst({
  tone = "surface",
  className,
}: {
  tone?: "surface" | "highlight";
  className?: string;
}) {
  const colors = BURST_COLORS[tone];
  return (
    <div aria-hidden="true" className={cn(styles.burst, "top-1/3 -z-10", className)}>
      <span className={styles.burstRing} />
      {BURST_PIECES.map((piece, index) => (
        <span
          key={index}
          className={styles.burstPiece}
          data-shape={piece.shape}
          style={
            {
              "--angle": `${piece.angle}deg`,
              "--distance": `${piece.distance}px`,
              "--spin": `${piece.spin}deg`,
              "--piece-delay": `${piece.delay}ms`,
              "--piece-color": colors[index % colors.length],
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export { styles as gameStyles };
