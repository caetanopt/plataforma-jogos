import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Paginação partilhada.
 *
 * Substitui listas que imprimiam todos os números: com 80 páginas de leads a
 * paginação passava a ser mais alta do que a tabela. Aqui a janela é fixa, com
 * primeira e última sempre visíveis, e cada alvo cumpre os 24×24 px mínimos da
 * WCAG 2.2 (2.5.8).
 */

/** Páginas à volta da atual, para cada lado. */
const WINDOW = 2;

function pageList(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total]);
  for (let p = current - WINDOW; p <= current + WINDOW; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) out.push("gap");
    out.push(page);
    previous = page;
  }
  return out;
}

const itemClass =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan";

export function Pagination({
  page,
  pageCount,
  total,
  buildHref,
  label = "Paginação",
}: {
  page: number;
  pageCount: number;
  /** Total de registos, para a linha de posição. */
  total?: number;
  /** Devolve o href de uma página, preservando os filtros ativos. */
  buildHref: (page: number) => string;
  label?: string;
}) {
  if (pageCount <= 1) return null;

  const items = pageList(page, pageCount);

  return (
    <nav aria-label={label} className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-caetano-anthracite-80">
        Página {page} de {pageCount}
        {total != null ? ` · ${total} registos` : ""}
      </p>

      <ul className="flex flex-wrap items-center gap-1">
        <li>
          {page > 1 ? (
            <Link
              href={buildHref(page - 1)}
              rel="prev"
              className={cn(itemClass, "text-caetano-anthracite hover:bg-caetano-medium-gray-20")}
            >
              Anterior
            </Link>
          ) : (
            <span className={cn(itemClass, "cursor-default text-caetano-anthracite-40")} aria-hidden="true">
              Anterior
            </span>
          )}
        </li>

        {items.map((item, index) =>
          item === "gap" ? (
            <li key={`gap-${index}`} aria-hidden="true" className={cn(itemClass, "text-caetano-anthracite-80")}>
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={buildHref(item)}
                aria-current={item === page ? "page" : undefined}
                aria-label={`Página ${item}`}
                className={cn(
                  itemClass,
                  item === page
                    ? "bg-caetano-deep-blue font-bold text-white"
                    : "text-caetano-anthracite hover:bg-caetano-medium-gray-20",
                )}
              >
                {item}
              </Link>
            </li>
          ),
        )}

        <li>
          {page < pageCount ? (
            <Link
              href={buildHref(page + 1)}
              rel="next"
              className={cn(itemClass, "text-caetano-anthracite hover:bg-caetano-medium-gray-20")}
            >
              Seguinte
            </Link>
          ) : (
            <span className={cn(itemClass, "cursor-default text-caetano-anthracite-40")} aria-hidden="true">
              Seguinte
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
