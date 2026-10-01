import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface BarListItem {
  label: string;
  /** Valor que dá o comprimento da barra. */
  value: number;
  /** Denominador da barra; sem ele (ou a 0) a linha não tem barra. */
  max: number | null;
  /** O que se lê à direita. Por omissão, o próprio valor. */
  valueLabel?: ReactNode;
  /** `warning` para o que exige atenção (stock baixo). */
  tone?: "brand" | "warning";
}

/** Acima disto a lista passa a ter altura máxima e deslocamento próprio. */
const SCROLL_AFTER = 8;

/**
 * Lista de valores com uma barra fina por linha: origem, dispositivo, acerto
 * por pergunta, stock... Uma série só, por isso uma cor só (do azul profundo
 * ao azul cyan); o laranja dinâmico fica reservado para o que exige atenção.
 *
 * A barra é decorativa: o número está sempre escrito ao lado, e a cor nunca é
 * a única forma de ler o valor. As barras crescem da esquerda ao aparecer
 * (`@starting-style`), o que desliga sozinho com movimento reduzido.
 */
export function BarList({
  items,
  label,
  emptyText = "Sem dados.",
}: {
  items: BarListItem[];
  /** Nome acessível da zona com deslocamento, quando a lista é longa. */
  label: string;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-caetano-anthracite-80">{emptyText}</p>;
  }

  const list = (
    <ul className="space-y-3">
      {items.map((item, index) => {
        const ratio = item.max && item.max > 0 ? Math.min(1, Math.max(0, item.value / item.max)) : null;
        return (
          // Os rótulos podem repetir-se (perguntas com o mesmo título em
          // campanhas diferentes): a posição é a chave estável aqui.
          <li key={index}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 break-words text-caetano-anthracite">{item.label}</span>
              <span className="shrink-0 font-medium tabular-nums text-caetano-deep-blue">
                {item.valueLabel ?? item.value}
              </span>
            </div>
            {ratio !== null && (
              <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-caetano-medium-gray-20">
                <div
                  className={cn(
                    "h-full origin-left rounded-full transition-transform duration-700 ease-(--ease-out-expo) motion-safe:starting:scale-x-0",
                    item.tone === "warning"
                      ? "bg-caetano-dynamic-orange"
                      : "bg-linear-to-r from-caetano-deep-blue to-caetano-cyan",
                  )}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (items.length <= SCROLL_AFTER) return list;

  return (
    // Focável para quem usa teclado poder deslocar a lista (WCAG 2.1.1).
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="-mx-2 -my-1 max-h-80 overflow-y-auto overscroll-contain rounded-lg px-2 py-1 focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:outline-none"
    >
      {list}
    </div>
  );
}
