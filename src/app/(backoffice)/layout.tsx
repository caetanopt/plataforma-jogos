import type { ReactNode } from "react";
import type { Metadata } from "next";
import { LockOpen } from "lucide-react";
import { isLoginBypassed } from "@/server/auth/bypass";
import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { NAV_ITEMS } from "@/components/backoffice/nav-items";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/backoffice/sidebar";
import { Topbar } from "@/components/backoffice/topbar";
import { NavigationProgressProvider } from "@/components/backoffice/navigation-progress";

// O backoffice nunca deve aparecer num motor de busca — menos ainda com o
// login desligado, em que a raiz do site abre diretamente as pastas.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const context = await requireOrgContext();
  const loginBypassed = await isLoginBypassed();
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
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-caetano-deep-blue focus:shadow-lg focus:ring-2 focus:ring-caetano-cyan"
        >
          Saltar para o conteúdo
        </a>
        <Sidebar
          visibleHrefs={visibleHrefs}
          organizationName={organization?.name ?? ""}
          logoUrl={logo?.url}
        />
        {/* A luz do azul cyan no canto, como os fundos digitais do Brand Book
            (09): só no topo, por trás dos títulos; o resto fica no cinza. */}
        <div className="flex min-w-0 flex-1 flex-col bg-[radial-gradient(70%_360px_at_100%_0%,var(--color-caetano-cyan-20),transparent)] bg-no-repeat">
          {loginBypassed && (
            // Aviso permanente enquanto o login estiver desligado, para não ficar
            // assim por esquecimento. Fora do cabeçalho fixo: o editor e os estados
            // vazios contam com um cabeçalho de 64 px.
            <p className="flex items-start gap-2 border-b border-caetano-dynamic-orange-60 bg-caetano-freedom-yellow-20 px-4 py-2 text-sm text-caetano-anthracite md:px-8">
              <LockOpen size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                <strong className="font-bold">Login desligado.</strong> Qualquer pessoa com o link entra no
                backoffice sem password, como {context.userName}.
              </span>
            </p>
          )}
          <Topbar
            organizationName={organization?.name ?? ""}
            userName={context.userName}
            visibleHrefs={visibleHrefs}
            logoUrl={logo?.url}
            showLogout={!loginBypassed}
          />
          <main id="conteudo" tabIndex={-1} className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </NavigationProgressProvider>
  );
}
