import type { ReactNode } from "react";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/backoffice/sidebar";
import { Topbar } from "@/components/backoffice/topbar";

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

  const isOrgAdmin = context.isSuperAdmin || context.membership?.role === "ORG_ADMIN";

  return (
    <div className="flex min-h-screen flex-1 bg-caetano-medium-gray-20">
      <Sidebar
        isOrgAdmin={isOrgAdmin}
        organizationName={organization?.name ?? ""}
        logoUrl={logo?.url}
      />
      <div className="flex flex-1 flex-col">
        <Topbar
          organizationName={organization?.name ?? ""}
          userName={context.userName}
          isOrgAdmin={isOrgAdmin}
          logoUrl={logo?.url}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
