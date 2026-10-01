import { LogOut } from "lucide-react";
import { initials } from "@/lib/utils";
import { MobileNav } from "@/components/backoffice/mobile-nav";

export function Topbar({
  organizationName,
  userName,
  visibleHrefs,
  logoUrl,
}: {
  organizationName: string;
  userName: string;
  visibleHrefs: string[];
  logoUrl?: string | null;
}) {
  return (
    // Fixa ao fazer scroll, opaca: o conteúdo passa por baixo sem se ver.
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-caetano-medium-gray-40 bg-white px-4 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <MobileNav visibleHrefs={visibleHrefs} organizationName={organizationName} logoUrl={logoUrl} />
        <span className="truncate text-sm font-medium text-caetano-anthracite">{organizationName}</span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2.5 sm:flex">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-caetano-deep-blue text-xs font-bold text-white ring-2 ring-caetano-cyan-20"
          >
            {initials(userName)}
          </span>
          <span className="text-sm text-caetano-anthracite">{userName}</span>
        </span>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="flex min-h-10 cursor-pointer touch-manipulation items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-caetano-anthracite transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40"
          >
            <LogOut size={16} aria-hidden="true" />
            {/* No telemóvel só o ícone à vista, mas o botão continua a chamar-se "Sair". */}
            <span className="sr-only sm:not-sr-only">Sair</span>
          </button>
        </form>
      </div>
    </header>
  );
}
