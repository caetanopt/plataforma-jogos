import type { ReactNode } from "react";
import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/backoffice/sidebar";
import { Topbar } from "@/components/backoffice/topbar";
import { NavigationProgressProvider } from "@/components/backoffice/navigation-progress";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const context = await requireOrgContext();
  const organization = await prisma.organization.findUnique({
    where: { id: context.organizationId },
    select: { name: true, logoMediaId: true },
  });
  const logo = organization?.logoMediaId
    ? await prisma.mediaAsset.findFirst({
        where: { id: organization.logoMediaId, organizationId: context.organizationId },
        select: { url: true },
      })
    : null;

  const visibleHrefs = NAV_ITEMS.filter((item) => !item.permission || can(context, item.permission)).map(
    (item) => item.href,
  );

  return (
    <NavigationProgressProvider>
      <div className="flex min-h-screen flex-1 bg-caetano-medium-gray-20">
        {/* Primeiro elemento focável da página: permite saltar a navegação. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-caetano-deep-blue focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Saltar para o conteúdo
        </a>
        <Sidebar
          visibleHrefs={visibleHrefs}
          organizationName={organization?.name ?? ""}
          logoUrl={logo?.url}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            organizationName={organization?.name ?? ""}
            userName={context.userName}
            visibleHrefs={visibleHrefs}
            logoUrl={logo?.url}
          />
          <main id="conteudo" tabIndex={-1} className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </NavigationProgressProvider>
  );
}
