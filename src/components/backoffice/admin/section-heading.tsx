import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Título de uma secção das páginas de administração (Utilizadores, Espaços de
 * trabalho, Configurações): o ícone num quadrado do azul profundo ao azul
 * cyan, o título em Bold no azul profundo e uma linha mais leve por baixo —
 * a hierarquia do PageHeader, um nível abaixo.
 */
export function SectionHeading({
  id,
  title,
  description,
  icon,
  actions,
  className,
}: {
  /** Id do `<h2>`, para o `aria-labelledby` da secção. */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Ícone decorativo (lucide). */
  icon?: ReactNode;
  /** Contagens ou ações, à direita (por baixo em ecrãs estreitos). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap justify-between gap-3", description ? "items-start" : "items-center", className)}>
      <div className={cn("flex min-w-0 gap-3", description ? "items-start" : "items-center")}>
        {icon && (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-135 from-caetano-deep-blue to-caetano-cyan text-white shadow-sm"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 id={id} className="text-base font-bold text-caetano-deep-blue sm:text-lg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-caetano-anthracite-80">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
