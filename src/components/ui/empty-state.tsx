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
  icon,
  className,
}: {
  title: string;
  description?: string;
  /** Botão ou link que resolve o vazio. */
  action?: ReactNode;
  /** Ícone decorativo (lucide), mostrado num círculo do azul cyan. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("animate-enter px-6 py-12 text-center", className)}>
      {icon && (
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-caetano-cyan-20 text-caetano-deep-blue"
        >
          {icon}
        </div>
      )}
      <p className="text-base font-bold text-caetano-deep-blue">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-sm text-sm text-caetano-anthracite-80">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
