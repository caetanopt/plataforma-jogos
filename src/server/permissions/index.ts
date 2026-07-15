import type { MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

export type PermissionAction =
  | "workspace:manage"
  | "user:manage"
  | "brand:manage"
  | "campaign:create"
  | "campaign:edit"
  | "campaign:publish"
  | "campaign:archive"
  | "campaign:delete"
  | "leads:view"
  | "leads:export"
  | "stats:view"
  | "audit:view";

const ROLE_ACTIONS: Record<MembershipRole, PermissionAction[]> = {
  ORG_ADMIN: [
    "workspace:manage",
    "user:manage",
    "brand:manage",
    "campaign:create",
    "campaign:edit",
    "campaign:publish",
    "campaign:archive",
    "campaign:delete",
    "leads:view",
    "leads:export",
    "stats:view",
    "audit:view",
  ],
  EDITOR: ["campaign:create", "campaign:edit", "campaign:archive", "stats:view"],
  ANALYST: ["leads:view", "stats:view"],
  VIEWER: ["leads:view", "stats:view"],
};

/**
 * Verifica se o contexto atual (utilizador + organização) pode executar a ação.
 * Superadministrador ultrapassa sempre a matriz. Nunca confiar apenas no
 * frontend — usar sempre esta verificação (ou `assertCan`) no servidor.
 */
export function can(context: OrgContext, action: PermissionAction): boolean {
  if (context.isSuperAdmin) return true;
  if (!context.membership) return false;

  const { role, canPublish, canExportLeads } = context.membership;

  if (action === "campaign:publish" && role === "EDITOR") {
    return canPublish;
  }
  if (action === "leads:export" && role === "ANALYST") {
    return canExportLeads;
  }

  return ROLE_ACTIONS[role].includes(action);
}

export class PermissionDeniedError extends Error {
  constructor(action: PermissionAction) {
    super(`Ação não autorizada: ${action}`);
    this.name = "PermissionDeniedError";
  }
}

export function assertCan(context: OrgContext, action: PermissionAction): void {
  if (!can(context, action)) {
    throw new PermissionDeniedError(action);
  }
}
