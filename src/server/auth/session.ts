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
  | { ok: false; reason: "no_session" | "no_organization" };

/**
 * Resolve o contexto de organização ativo do utilizador autenticado, sem
 * redirecionar — as rotas da API respondem 401 em vez de um redirect HTML.
 * Junta-se sempre à base de dados para obter o papel/flags atuais em vez de
 * confiar no token — mudanças de permissão feitas por um admin aplicam-se de
 * imediato.
 */
export async function resolveOrgContext(): Promise<OrgContextResult> {
  const session = await auth();
  const user = session?.user;
  if (!user) return { ok: false, reason: "no_session" };

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
}

/** Para páginas e server actions: sem sessão ou organização, vai para o login. */
export async function requireOrgContext(): Promise<OrgContext> {
  const result = await resolveOrgContext();
  if (!result.ok) redirect(result.reason === "no_session" ? "/login" : "/login?error=no_organization");
  return result.context;
}
