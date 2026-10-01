import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cartão do backoffice.
 *
 * A mesma cadeia de classes estava repetida 64 vezes em dezenas de ficheiros.
 * Uma alteração de raio, borda ou fundo obrigava a caçá-las todas — e algumas
 * já tinham divergido.
 */
export function Card({
  as: Tag = "div",
  padding = "md",
  interactive = false,
  className,
  children,
  ...props
}: {
  as?: ElementType;
  padding?: "none" | "sm" | "md" | "lg";
  /** Cartão que é (ou contém) um link para outro sítio: sobe ao passar o rato. */
  interactive?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const paddingClass = { none: "", sm: "p-3", md: "p-4 sm:p-5", lg: "p-5 sm:p-6" }[padding];

  return (
    <Tag
      className={cn(
        // Uma linha fina e uma sombra do azul profundo: o cartão destaca-se do
        // fundo sem uma borda pesada.
        "rounded-2xl border border-caetano-medium-gray-40 bg-white shadow-xs",
        interactive &&
          "transition-[box-shadow,translate,border-color] duration-300 ease-(--ease-out-expo) hover:border-caetano-medium-gray-60 hover:shadow-md motion-safe:hover:-translate-y-0.5",
        paddingClass,
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
