import { LogOut } from "lucide-react";
import { MobileNav } from "@/components/backoffice/mobile-nav";

export function Topbar({
  organizationName,
  userName,
  isOrgAdmin,
}: {
  organizationName: string;
  userName: string;
  isOrgAdmin: boolean;
}) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-caetano-medium-gray/30 bg-white px-4 md:px-6">
      <div className="flex items-center gap-3">
        <MobileNav isOrgAdmin={isOrgAdmin} />
        <span className="text-sm font-medium text-caetano-anthracite">{organizationName}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-sm text-caetano-anthracite sm:inline">{userName}</span>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-neutral-100"
          >
            <LogOut size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </form>
      </div>
    </header>
  );
}
