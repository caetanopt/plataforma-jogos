"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { BrandLogo } from "@/components/backoffice/brand-logo";
import { cn } from "@/lib/utils";

export function Sidebar({
  isOrgAdmin,
  organizationName,
  logoUrl,
}: {
  isOrgAdmin: boolean;
  organizationName: string;
  logoUrl?: string | null;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="hidden w-60 flex-col gap-1 border-r border-caetano-medium-gray-40 bg-white p-4 md:flex"
    >
      <div className="mb-6 flex items-center px-2">
        <BrandLogo logoUrl={logoUrl} organizationName={organizationName} />
      </div>
      {NAV_ITEMS.filter((item) => !item.adminOnly || isOrgAdmin).map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-caetano-deep-blue text-white"
                : "text-caetano-anthracite hover:bg-caetano-medium-gray-20",
            )}
          >
            <Icon size={18} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
