"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { summaryClass } from "@/components/ui/menu-classes";

/**
 * Menu baseado em `<details>`, com o comportamento que o elemento nativo não
 * traz: fecha ao clicar fora e ao carregar Esc, devolvendo o foco ao botão.
 *
 * Sem isto, abrir dois menus deixava ambos abertos e a única forma de fechar
 * era voltar a clicar no mesmo `<summary>`.
 *
 * Mantém-se `<details>` em vez de um menu com estado em React porque funciona
 * sem JavaScript — importante num backoffice que é quase todo Server
 * Components.
 */
export function DetailsMenu({
  label,
  ariaLabel,
  children,
  align = "right",
  summaryClassName,
  panelClassName,
}: {
  /** Conteúdo do botão que abre o menu. */
  label: ReactNode;
  /** Obrigatório quando o `label` é só um símbolo, como "⋯". */
  ariaLabel?: string;
  children: ReactNode;
  align?: "left" | "right";
  summaryClassName?: string;
  panelClassName?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;

    function close() {
      if (details && details.open) details.open = false;
    }

    function onPointerDown(event: PointerEvent) {
      if (!details?.open) return;
      if (event.target instanceof Node && details.contains(event.target)) return;
      close();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details?.open) return;
      close();
      details.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={detailsRef} className="relative inline-block text-left">
      <summary aria-label={ariaLabel} className={cn(summaryClass, summaryClassName)}>
        {label}
      </summary>
      <div
        className={cn(
          "absolute z-20 mt-1.5 w-56 rounded-xl border border-caetano-medium-gray-40 bg-white p-1.5 shadow-lg",
          // Abre a partir do botão (o canto de onde sai), parado com movimento reduzido.
          "motion-safe:animate-scale-in",
          align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}
