"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { ProgressLink } from "@/components/backoffice/navigation-progress";
import { BrandLogo } from "@/components/backoffice/brand-logo";
import { cn } from "@/lib/utils";

export function MobileNav({
  isOrgAdmin,
  organizationName,
  logoUrl,
}: {
  isOrgAdmin: boolean;
  organizationName: string;
  logoUrl?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
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
        className="flex h-10 w-10 cursor-pointer touch-manipulation items-center justify-center rounded-lg text-caetano-anthracite transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div
            ref={dialogRef}
            className="w-64 bg-white p-4 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label="Navegação"
          >
            <div className="mb-6 flex items-center justify-between px-2">
              <BrandLogo logoUrl={logoUrl} organizationName={organizationName} />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Navegação principal" className="flex flex-col gap-1">
              {NAV_ITEMS.filter((item) => !item.adminOnly || isOrgAdmin).map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <ProgressLink
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                      isActive
                        ? "bg-caetano-deep-blue text-white"
                        : "text-caetano-anthracite hover:bg-caetano-medium-gray-20",
                    )}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {item.label}
                  </ProgressLink>
                );
              })}
            </nav>
          </div>
          <button
            type="button"
            aria-label="Fechar menu"
            className="flex-1 bg-black/40"
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
