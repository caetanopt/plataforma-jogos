import type { SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Seletor dos filtros das estatísticas, com o mesmo aspeto do `Input`: borda
 * a 3:1 (WCAG 1.4.11), anel do azul cyan no foco e a seta desenhada por nós —
 * a seta nativa muda de browser para browser e desalinha a barra de filtros.
 * Continua a ser um `<select>` nativo: teclado, leitores de ecrã e o seletor
 * do telemóvel funcionam como sempre.
 */
export function FilterSelect({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-10 w-full cursor-pointer appearance-none truncate rounded-lg border border-caetano-anthracite-60 bg-white pr-9 pl-3 text-sm text-caetano-anthracite shadow-xs",
          "transition-[border-color,box-shadow] duration-200 ease-(--ease-out-expo) hover:border-caetano-anthracite-80",
          "focus-visible:border-caetano-deep-blue focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 my-auto text-caetano-anthracite-80"
      />
    </div>
  );
}
