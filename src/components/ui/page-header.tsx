import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho de página do backoffice, com a hierarquia dos títulos do Brand
 * Book (02.1, 04.1): o título em Montserrat Bold no azul profundo e, logo
 * abaixo, uma linha mais leve que diz do que trata a página.
 *
 * No manual a segunda linha é cinza; aqui é o antracite -80 (6,1:1 sobre o
 * fundo), porque é texto que se lê e não um elemento decorativo.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Botões e links da página, à direita (por baixo em ecrãs estreitos). */
  actions?: ReactNode;
  /** Contexto curto por cima do título (por exemplo, a secção). */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-caetano-deep-blue-80">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold leading-tight tracking-tight text-caetano-deep-blue sm:text-[2rem]">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-base font-light text-caetano-anthracite-80 sm:text-lg">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
