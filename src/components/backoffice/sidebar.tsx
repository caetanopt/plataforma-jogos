import { BrandLogo } from "@/components/backoffice/brand-logo";
import { BrandClaim, NavList } from "@/components/backoffice/nav-list";

export function Sidebar({
  visibleHrefs,
  organizationName,
  logoUrl,
}: {
  /** Entradas que o papel permite, calculadas no servidor. */
  visibleHrefs: string[];
  organizationName: string;
  logoUrl?: string | null;
}) {
  return (
    <nav
      aria-label="Navegação principal"
      // Fixa à altura do ecrã: a navegação fica à mão numa página longa.
      className="surface-sidebar sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto px-4 pb-5 pt-6 md:flex"
    >
      <div className="mb-8 flex min-h-10 items-center px-3">
        <BrandLogo logoUrl={logoUrl} organizationName={organizationName} onDark />
      </div>
      <NavList visibleHrefs={visibleHrefs} />
      <div className="mt-auto px-3 pt-8">
        <BrandClaim />
      </div>
    </nav>
  );
}
