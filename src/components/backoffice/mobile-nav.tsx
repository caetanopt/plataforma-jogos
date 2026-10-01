"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandLogo } from "@/components/backoffice/brand-logo";
import { BrandClaim, NavList } from "@/components/backoffice/nav-list";

export function MobileNav({
  visibleHrefs,
  organizationName,
  logoUrl,
}: {
  /** Entradas que o papel permite, calculadas no servidor. */
  visibleHrefs: string[];
  organizationName: string;
  logoUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  // Um role="dialog"+aria-modal="true" sem gestão de foco não é realmente
  // modal para quem usa teclado: dava para sair do painel com Tab e o Esc
  // não fazia nada. Move o foco para dentro ao abrir, devolve-o ao botão
  // que abriu o menu ao fechar com Esc, e mantém o Tab a circular só pelos
  // elementos focáveis do painel enquanto estiver aberto.
  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        openButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu de navegação"
        aria-expanded={open}
        className="flex h-10 w-10 cursor-pointer touch-manipulation items-center justify-center rounded-xl text-caetano-deep-blue transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            ref={dialogRef}
            // Desliza da esquerda, de onde vem o botão (parado com movimento reduzido).
            className="surface-sidebar flex w-72 max-w-[85vw] flex-col overflow-y-auto px-4 pb-5 pt-5 shadow-lg motion-safe:animate-[slide-in-left_var(--duration-base)_var(--ease-out-expo)]"
            role="dialog"
            aria-modal="true"
            aria-label="Navegação"
          >
            <div className="mb-6 flex items-center justify-between px-3">
              <BrandLogo logoUrl={logoUrl} organizationName={organizationName} onDark />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-white transition-colors hover:bg-caetano-deep-blue-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-deep-blue"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Navegação principal">
              <NavList visibleHrefs={visibleHrefs} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="mt-auto px-3 pt-8">
              <BrandClaim />
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            className="flex-1 bg-caetano-anthracite/50 motion-safe:animate-fade-in"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
