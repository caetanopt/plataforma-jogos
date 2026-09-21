import { LogOut } from "lucide-react";
import { MobileNav } from "@/components/backoffice/mobile-nav";

export function Topbar({
  organizationName,
  userName,
  isOrgAdmin,
  logoUrl,
}: {
  organizationName: string;
  userName: string;
  isOrgAdmin: boolean;
  logoUrl?: string | null;
}) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-caetano-medium-gray-40 bg-white px-4 md:px-6">
      <div className="flex items-center gap-3">
        <MobileNav isOrgAdmin={isOrgAdmin} organizationName={organizationName} logoUrl={logoUrl} />
        <span className="text-sm font-medium text-caetano-anthracite">{organizationName}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-sm text-caetano-anthracite sm:inline">{userName}</span>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="flex cursor-pointer touch-manipulation items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-caetano-anthracite transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40"
          >
            <LogOut size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </form>
      </div>
    </header>
  );
}
