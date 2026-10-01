import { Brain, Disc3, ListChecks, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignType } from "@/generated/prisma/client";

/**
 * Identidade visual de cada tipo de jogo no backoffice: o ícone num mosaico
 * do azul profundo ao azul cyan (como o das pastas) e uma ilustração
 * decorativa feita só com cores da paleta.
 *
 * Tudo aqui é decorativo (`aria-hidden`): o tipo é sempre dito por texto ao
 * lado. As animações respondem ao `group/type` do cartão (passar o rato ou
 * `data-selected`) e só correm com `motion-safe`.
 */

export const GAME_TYPE_ICONS: Record<CampaignType, LucideIcon> = {
  MEMORY: Brain,
  WHEEL: Disc3,
  QUIZ: ListChecks,
};

/** Fundo claro de cada tipo: tons -20 da paleta, para distinguir sem gritar. */
const ARTWORK_BACKGROUND: Record<CampaignType, string> = {
  MEMORY: "from-caetano-cyan-20 to-caetano-deep-blue-20",
  WHEEL: "from-caetano-freedom-yellow-20 to-caetano-cyan-20",
  QUIZ: "from-caetano-eco-green-20 to-caetano-cyan-20",
};

export function GameTypeTile({
  type,
  size = "md",
  className,
}: {
  type: CampaignType;
  size?: "md" | "lg";
  className?: string;
}) {
  const Icon = GAME_TYPE_ICONS[type];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-linear-135 from-caetano-deep-blue to-caetano-cyan text-white shadow-sm",
        size === "md" ? "h-10 w-10 rounded-xl" : "h-12 w-12 rounded-2xl",
        className,
      )}
    >
      <Icon size={size === "md" ? 18 : 22} />
    </span>
  );
}

const lift = "transition-transform duration-500 ease-(--ease-out-expo) motion-safe:group-hover/type:-translate-y-1 motion-safe:group-data-selected/type:-translate-y-1";

function MemoryScene({ size }: { size: "md" | "lg" }) {
  // Duas cartas viradas formam um par: o resto mostra o verso.
  const faceUp = new Set([1, 6]);
  return (
    <div className={cn("grid grid-cols-4", size === "md" ? "gap-1.5" : "gap-2")}>
      {Array.from({ length: 8 }, (_, index) => (
        <span
          key={index}
          style={{ transitionDelay: `${index * 30}ms` }}
          className={cn(
            "flex items-center justify-center rounded-md shadow-sm",
            size === "md" ? "h-10 w-8" : "h-12 w-10",
            faceUp.has(index)
              ? "bg-white text-caetano-cyan ring-1 ring-caetano-cyan-40"
              : "bg-linear-160 from-caetano-deep-blue-80 to-caetano-deep-blue",
            lift,
          )}
        >
          {faceUp.has(index) ? (
            <Sparkles size={size === "md" ? 14 : 16} />
          ) : (
            <span className="h-2 w-2 rotate-45 rounded-[2px] border border-caetano-deep-blue-40" />
          )}
        </span>
      ))}
    </div>
  );
}

function WheelScene({ size }: { size: "md" | "lg" }) {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 14 12"
        className="absolute left-1/2 top-0 z-10 h-3 w-3.5 -translate-x-1/2 -translate-y-1/3 fill-caetano-deep-blue drop-shadow-sm"
      >
        <path d="M0 0h14L7 12z" />
      </svg>
      <div
        className={cn(
          "rounded-full shadow-md ring-4 ring-white",
          "transition-transform duration-700 ease-(--ease-out-expo) motion-safe:group-hover/type:rotate-[120deg] motion-safe:group-data-selected/type:rotate-[120deg]",
          size === "md" ? "h-24 w-24" : "h-28 w-28",
        )}
        style={{
          background:
            "conic-gradient(from -30deg, var(--color-caetano-deep-blue) 0 60deg, var(--color-caetano-cyan) 60deg 120deg, var(--color-caetano-deep-blue-80) 120deg 180deg, var(--color-caetano-freedom-yellow) 180deg 240deg, var(--color-caetano-deep-blue) 240deg 300deg, var(--color-caetano-cyan-60) 300deg 360deg)",
        }}
      />
      <span className="absolute inset-0 m-auto h-5 w-5 rounded-full bg-white shadow-sm ring-2 ring-caetano-deep-blue" />
    </div>
  );
}

function QuizScene({ size }: { size: "md" | "lg" }) {
  const md = size === "md";
  const answer = cn("flex items-center gap-1.5 rounded-md border px-1.5", md ? "h-4" : "h-5");
  return (
    <div className={cn("rounded-xl bg-white shadow-md", md ? "w-36 p-2" : "w-44 p-2.5", lift)}>
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn("h-1 flex-1 rounded-full", step < 2 ? "bg-caetano-deep-blue" : "bg-caetano-medium-gray-40")}
          />
        ))}
      </div>
      <span className={cn("block w-3/4 rounded-full bg-caetano-deep-blue", md ? "mt-1.5 h-1.5" : "mt-2 h-2")} />
      <span className="mt-1 block h-1.5 w-1/2 rounded-full bg-caetano-medium-gray-40" />
      <div className={md ? "mt-2 space-y-1" : "mt-2.5 space-y-1.5"}>
        <span className={cn(answer, "border-caetano-medium-gray-40")}>
          <span className="h-2 w-2 rounded-full border border-caetano-medium-gray" />
          <span className="h-1.5 w-12 rounded-full bg-caetano-medium-gray-40" />
        </span>
        <span className={cn(answer, "border-caetano-eco-green bg-caetano-eco-green-20")}>
          <span className="h-2 w-2 rounded-full bg-caetano-eco-green" />
          <span className="h-1.5 w-16 rounded-full bg-caetano-eco-green-40" />
        </span>
        <span className={cn(answer, "border-caetano-medium-gray-40")}>
          <span className="h-2 w-2 rounded-full border border-caetano-medium-gray" />
          <span className="h-1.5 w-10 rounded-full bg-caetano-medium-gray-40" />
        </span>
      </div>
    </div>
  );
}

/**
 * Miniatura ilustrada de um tipo de jogo. Não há imagem por campanha na
 * listagem, por isso a miniatura é a do tipo — reconhecível de relance.
 */
export function GameTypeArtwork({
  type,
  size = "md",
  compactOnMobile = false,
  className,
}: {
  type: CampaignType;
  size?: "md" | "lg";
  /** Ilustração 20% mais pequena em ecrãs estreitos (cartões mais baixos numa lista longa). */
  compactOnMobile?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative isolate flex items-center justify-center overflow-hidden bg-linear-135",
        ARTWORK_BACKGROUND[type],
        className,
      )}
    >
      {/* Linhas largas e suaves, a fluidez das aplicações digitais do manual. */}
      <span className="absolute -right-16 -top-20 -z-10 h-48 w-48 rounded-full border-[6px] border-white" />
      <span className="absolute -bottom-12 -left-10 -z-10 h-28 w-28 rounded-full border-4 border-white" />
      <div className={cn(compactOnMobile && "max-sm:scale-[0.8]")}>
        {type === "MEMORY" && <MemoryScene size={size} />}
        {type === "WHEEL" && <WheelScene size={size} />}
        {type === "QUIZ" && <QuizScene size={size} />}
      </div>
    </div>
  );
}
