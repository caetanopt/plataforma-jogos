"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { cn } from "@/lib/utils";

export function MobileNav({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu de navegação"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-caetano-anthracite hover:bg-neutral-100"
      >
        <Menu size={22} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-64 bg-white p-4 shadow-lg" role="dialog" aria-modal="true" aria-label="Navegação">
            <div className="mb-6 flex items-center justify-between px-2">
              <span className="text-lg font-semibold text-caetano-deep-blue">caetano</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-neutral-100"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Navegação principal" className="flex flex-col gap-1">
              {NAV_ITEMS.filter((item) => !item.adminOnly || isOrgAdmin).map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                      isActive
                        ? "bg-caetano-deep-blue text-white"
                        : "text-caetano-anthracite hover:bg-neutral-100",
                    )}
                  >
                    <Icon size={18} aria-hidden="true" />
                    {item.label}
                  </Link>
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
