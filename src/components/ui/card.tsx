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
  className,
  children,
  ...props
}: {
  as?: ElementType;
  padding?: "none" | "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  const paddingClass = { none: "", sm: "p-3", md: "p-4", lg: "p-6" }[padding];

  return (
    <Tag
      className={cn(
        "rounded-xl border border-caetano-medium-gray-40 bg-white",
        paddingClass,
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
