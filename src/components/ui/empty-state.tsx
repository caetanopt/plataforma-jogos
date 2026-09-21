import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio partilhado.
 *
 * Estavam espalhados por quatro formatos diferentes — uns num `<p>` solto,
 * outros num cartão, com espaçamentos e tons distintos. O mesmo vazio lia-se
 * de forma diferente consoante a página.
 *
 * Um estado vazio útil diz o que falta e como resolver, por isso a ação é
 * parte do componente e não um extra.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  /** Botão ou link que resolve o vazio. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-10 text-center", className)}>
      <p className="text-sm font-medium text-caetano-anthracite">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-caetano-anthracite-80">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
