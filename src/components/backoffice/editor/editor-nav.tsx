"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Check, TriangleAlert } from "lucide-react";
import { EDITOR_STEPS } from "@/components/backoffice/editor/steps";
import { ProgressLink } from "@/components/backoffice/navigation-progress";
import { cn } from "@/lib/utils";

/**
 * Navegação entre as etapas do editor: um stepper vertical no computador
 * (números ligados por uma linha, a etapa atual no azul profundo) e uma faixa
 * horizontal que desliza no telemóvel, com a etapa atual sempre à vista.
 *
 * É a mesma lista nos dois casos: a disposição muda com a largura.
 */
export function EditorNav({
  campaignId,
  incompleteSteps,
}: {
  campaignId: string;
  incompleteSteps: string[];
}) {
  const pathname = usePathname();
  const listRef = useRef<HTMLOListElement>(null);
  const firstScrollRef = useRef(true);

  const completedCount = EDITOR_STEPS.filter((step) => !incompleteSteps.includes(step.slug)).length;
  const progress = Math.round((completedCount / EDITOR_STEPS.length) * 100);

  // Na faixa horizontal, a etapa atual fica ao centro. Só mexe no scroll da
  // própria lista (nunca no da página) e só quando ela desliza.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    // Pelas caixas no ecrã e não por `offsetLeft`, que conta a partir do
    // `<li>` (posicionado) e dava sempre zero.
    const listBox = list.getBoundingClientRect();
    const itemBox = current.getBoundingClientRect();
    const left = list.scrollLeft + (itemBox.left - listBox.left) - (list.clientWidth - itemBox.width) / 2;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left, behavior: firstScrollRef.current || reduceMotion ? "auto" : "smooth" });
    firstScrollRef.current = false;
  }, [pathname]);

  return (
    <nav
      aria-label="Etapas do editor"
      // Fixa ao fazer scroll, por baixo da barra de topo (h-16). Num ecrã
      // baixo, desliza por dentro em vez de ficar cortada.
      className="min-w-0 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto xl:pb-1"
    >
      <div className="rounded-2xl border border-caetano-medium-gray-40 bg-white shadow-xs">
        <div className="px-4 pt-3.5 pb-2 xl:px-5 xl:pt-5 xl:pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-caetano-deep-blue-80">Etapas</p>
            <p className="text-xs text-caetano-anthracite-80">
              <span className="font-bold text-caetano-deep-blue">{completedCount}</span> de {EDITOR_STEPS.length}{" "}
              completas
            </p>
          </div>
          {/* O texto acima já diz o progresso: a barra é só o desenho dele. */}
          <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-caetano-medium-gray-40">
            <div
              className="h-full rounded-full bg-linear-to-r from-caetano-deep-blue to-caetano-cyan transition-[width] duration-700 ease-(--ease-out-expo)"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <ol
          ref={listRef}
          className="flex snap-x scroll-px-2 gap-1 overflow-x-auto px-2 pt-1 pb-2 [scrollbar-width:thin] xl:flex-col xl:gap-0 xl:overflow-visible xl:px-2.5 xl:pb-3"
        >
          {EDITOR_STEPS.map((step, index) => {
            const isActive = pathname === `/apps/${campaignId}/${step.slug}`;
            const isIncomplete = incompleteSteps.includes(step.slug);
            const isLast = index === EDITOR_STEPS.length - 1;
            return (
              <li
                key={step.slug}
                className={cn(
                  "relative shrink-0 snap-start xl:shrink",
                  // A linha que liga os círculos (só no stepper vertical).
                  !isLast &&
                    "xl:before:absolute xl:before:top-[2.375rem] xl:before:-bottom-1.5 xl:before:left-[25.5px] xl:before:w-px xl:before:bg-caetano-medium-gray-40",
                )}
              >
                <ProgressLink
                  href={`/apps/${campaignId}/${step.slug}`}
                  // Sem prefetch: cada autosave refazia o prefetch das dez
                  // etapas (dezenas de pedidos por página). A navegação mostra
                  // a barra de progresso (ProgressLink).
                  prefetch={false}
                  aria-current={isActive ? "step" : undefined}
                  className={cn(
                    "group relative flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium",
                    "transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo)",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-caetano-cyan",
                    "xl:whitespace-normal xl:py-1.5",
                    isActive
                      ? "bg-caetano-deep-blue text-white shadow-md"
                      : "text-caetano-anthracite hover:bg-caetano-medium-gray-20 hover:text-caetano-deep-blue active:bg-caetano-medium-gray-40",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      isActive
                        ? "bg-white text-caetano-deep-blue ring-4 ring-caetano-deep-blue-80 motion-safe:animate-scale-in"
                        : isIncomplete
                          ? "bg-caetano-dynamic-orange-20 text-caetano-anthracite ring-1 ring-caetano-dynamic-orange"
                          : "bg-caetano-eco-green-20 text-caetano-deep-blue ring-1 ring-caetano-eco-green",
                    )}
                  >
                    {isActive ? (
                      index + 1
                    ) : isIncomplete ? (
                      <TriangleAlert size={13} strokeWidth={2.25} />
                    ) : (
                      <Check size={14} strokeWidth={2.75} />
                    )}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 leading-snug transition-transform duration-200 ease-(--ease-out-expo)",
                      !isActive && "xl:motion-safe:group-hover:translate-x-0.5",
                    )}
                  >
                    {step.label}
                  </span>
                  {/* A cor sozinha (laranja/verde) não chega para distinguir
                      incompleta de completa — WCAG 1.4.1 — e o ícone acima é
                      decorativo (aria-hidden). Este texto dá a mesma
                      informação a leitores de ecrã. */}
                  {!isActive && <span className="sr-only">{isIncomplete ? " (incompleta)" : " (completa)"}</span>}
                </ProgressLink>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
