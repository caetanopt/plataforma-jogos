import { cache } from "react";
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

export type OrgContextResult =
  | { ok: true; context: OrgContext }
  | { ok: false; reason: "no_session" | "no_organization" | "suspended" };

/**
 * Resolve o contexto de organização ativo do utilizador autenticado, sem
 * redirecionar — as rotas da API respondem 401 em vez de um redirect HTML.
 *
 * O token só diz quem é: o estado do utilizador (ativo, superadmin), o papel
 * e as flags, e a suspensão da organização vêm sempre da base de dados, para
 * que uma revogação se aplique no pedido seguinte e não só quando o JWT (8 h)
 * expirar. `cache` evita repetir as consultas no mesmo pedido (layout e
 * página chamam isto os dois).
 */
export const resolveOrgContext = cache(async (): Promise<OrgContextResult> => {
  const session = await auth();
  const sessionUser = session?.user;
  if (!sessionUser) return { ok: false, reason: "no_session" };

  const dbUser = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { id: true, name: true, email: true, isActive: true, isSuperAdmin: true },
  });
  if (!dbUser || !dbUser.isActive) return { ok: false, reason: "no_session" };
  const user = { ...dbUser, activeOrganizationId: sessionUser.activeOrganizationId };

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
    if (!fallback) return { ok: false, reason: "no_organization" };
    membership = fallback;
    organizationId = fallback.organizationId;
  }

  if (!organizationId) return { ok: false, reason: "no_organization" };

  // Secção 3: "suspender organizações". O superadmin continua a entrar.
  if (!user.isSuperAdmin) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { suspendedAt: true },
    });
    if (!organization || organization.suspendedAt) return { ok: false, reason: "suspended" };
  }

  return {
    ok: true,
    context: {
      userId: user.id,
      userName: user.name ?? user.email ?? "",
      userEmail: user.email ?? "",
      isSuperAdmin: user.isSuperAdmin,
      organizationId,
      membership,
    },
  };
});

/** Para páginas e server actions: sem sessão ou organização, vai para o login. */
export async function requireOrgContext(): Promise<OrgContext> {
  const result = await resolveOrgContext();
  if (!result.ok) {
    redirect(
      result.reason === "no_session"
        ? "/login"
        : result.reason === "suspended"
          ? "/login?error=suspended"
          : "/login?error=no_organization",
    );
  }
  return result.context;
}
