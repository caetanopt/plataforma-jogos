"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { ProgressLink } from "@/components/backoffice/navigation-progress";
import { cn } from "@/lib/utils";

/**
 * As entradas da navegação principal, sobre o azul profundo da barra lateral
 * (e do menu móvel, que é a mesma lista).
 *
 * Texto no azul profundo -20 (10:1 sobre o azul profundo); a entrada da
 * página atual fica branca com o texto azul (13,5:1), para se ver de longe
 * onde se está.
 */
export function NavList({ visibleHrefs, onNavigate }: { visibleHrefs: string[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => visibleHrefs.includes(item.href)).map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <ProgressLink
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                "transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo)",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-caetano-deep-blue",
                isActive
                  ? "bg-white text-caetano-deep-blue shadow-md"
                  : "text-caetano-deep-blue-20 hover:bg-caetano-deep-blue-80 hover:text-white active:bg-caetano-deep-blue",
              )}
            >
              <Icon
                size={18}
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-transform duration-200 ease-(--ease-out-expo)",
                  !isActive && "motion-safe:group-hover:translate-x-0.5",
                )}
              />
              {item.label}
            </ProgressLink>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * O claim da marca (Brand Book 07.2, versão negativa): Montserrat Medium, a
 * branco sobre o azul profundo. Está em inglês no manual.
 */
export function BrandClaim({ className }: { className?: string }) {
  return (
    <p lang="en" className={cn("text-sm font-medium text-white", className)}>
      Your favourite way to move
    </p>
  );
}
