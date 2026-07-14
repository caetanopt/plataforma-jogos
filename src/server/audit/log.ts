import { prisma } from "@/server/db/client";
import type { AuditAction, Prisma } from "@/generated/prisma/client";

interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  result: "SUCCESS" | "FAILURE";
  metadata?: Prisma.InputJsonValue;
}

/**
 * Regista eventos de auditoria (secção 26). `metadata` nunca deve conter dados
 * pessoais (nomes, e-mails, telefones) — apenas identificadores e contexto técnico.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: entry.organizationId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      result: entry.result,
      metadata: entry.metadata ?? undefined,
    },
  });
}
