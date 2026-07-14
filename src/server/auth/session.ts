import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/client";
import type { Membership } from "@/generated/prisma/client";

export interface OrgContext {
  userId: string;
  userName: string;
  userEmail: string;
  isSuperAdmin: boolean;
  organizationId: string;
  membership: Membership | null;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  return session.user;
}

/**
 * Resolve o contexto de organização ativo do utilizador autenticado. Junta-se
 * sempre à base de dados para obter o papel/flags atuais em vez de confiar no
 * token — mudanças de permissão feitas por um admin aplicam-se de imediato.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const user = await requireUser();

  let organizationId = user.activeOrganizationId;
  let membership: Membership | null = null;

  if (organizationId) {
    membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId } },
    });
  }

  if (!membership && !user.isSuperAdmin) {
    const fallback = await prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!fallback) {
      redirect("/login?error=no_organization");
    }
    membership = fallback;
    organizationId = fallback.organizationId;
  }

  if (!organizationId) {
    redirect("/login?error=no_organization");
  }

  return {
    userId: user.id,
    userName: user.name ?? user.email ?? "",
    userEmail: user.email ?? "",
    isSuperAdmin: user.isSuperAdmin,
    organizationId,
    membership,
  };
}
