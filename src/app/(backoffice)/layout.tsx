import type { ReactNode } from "react";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { Sidebar } from "@/components/backoffice/sidebar";
import { Topbar } from "@/components/backoffice/topbar";

export default async function BackofficeLayout({ children }: { children: ReactNode }) {
  const context = await requireOrgContext();
  const organization = await prisma.organization.findUnique({
    where: { id: context.organizationId },
    select: { name: true },
  });

  const isOrgAdmin = context.isSuperAdmin || context.membership?.role === "ORG_ADMIN";

  return (
    <div className="flex min-h-screen flex-1 bg-neutral-50">
      <Sidebar isOrgAdmin={isOrgAdmin} />
      <div className="flex flex-1 flex-col">
        <Topbar
          organizationName={organization?.name ?? ""}
          userName={context.userName}
          isOrgAdmin={isOrgAdmin}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
