import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlClass } from "@/components/ui/input";

/*
  `<select>` nativo com o aspeto do `Input`: a mesma borda de 3:1 (WCAG
  1.4.11), o mesmo anel de foco e uma seta da família de ícones em vez da do
  sistema, que muda de browser para browser. Continua a ser o controlo nativo
  — teclado, leitores de ecrã e o seletor do telemóvel funcionam como sempre
  e os filtros submetem sem JavaScript.

  Um só sítio: havia três cópias (início, estatísticas, editor) e mais uma no
  seletor de espaço de trabalho e pasta.
*/

/** As classes do `<select>` (para os que já vêm prontos, como o SyncedSelect). */
export const selectClass = cn("w-full min-w-0 cursor-pointer appearance-none truncate pr-9", controlClass);

/** Contentor com a seta; um `<span>` para poder ficar dentro de um `<label>`. */
export function SelectShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("relative block", className)}>
      {children}
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 my-auto text-caetano-anthracite-80"
      />
    </span>
  );
}

export function Select({
  className,
  wrapperClassName,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { wrapperClassName?: string }) {
  return (
    <SelectShell className={wrapperClassName}>
      <select className={cn(selectClass, className)} {...props}>
        {children}
      </select>
    </SelectShell>
  );
}
