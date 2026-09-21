"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

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
          "absolute z-20 mt-1 w-56 rounded-lg border border-caetano-medium-gray-40 bg-white p-1 shadow-lg",
          align === "right" ? "right-0" : "left-0",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
}

/** Estilo partilhado dos `<summary>` usados como botão de menu. */
export const summaryClass = cn(
  "flex h-8 w-8 cursor-pointer list-none select-none items-center justify-center rounded-lg",
  "text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
  // O Safari continua a desenhar o triângulo sem isto.
  "[&::-webkit-details-marker]:hidden",
);

/** Estilo partilhado dos itens dentro de um menu. */
export const menuItemClass = cn(
  "block w-full cursor-pointer rounded-md px-3 py-1.5 text-left text-sm text-caetano-anthracite",
  "transition-colors hover:bg-caetano-medium-gray-20 active:bg-caetano-medium-gray-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
);
