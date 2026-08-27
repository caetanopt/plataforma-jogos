import { describe, expect, it } from "vitest";
import { assertCan, can, PermissionDeniedError, type PermissionAction } from "@/server/permissions";
import type { OrgContext } from "@/server/auth/session";
import type { Membership, MembershipRole } from "@/generated/prisma/client";

const ALL_ACTIONS: PermissionAction[] = [
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
];

function membership(
  role: MembershipRole,
  overrides: Partial<Pick<Membership, "canPublish" | "canExportLeads">> = {},
): Membership {
  return {
    id: "membership-1",
    userId: "user-1",
    organizationId: "org-1",
    role,
    canPublish: false,
    canExportLeads: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Membership;
}

function context(overrides: Partial<OrgContext>): OrgContext {
  return {
    userId: "user-1",
    userName: "Teste",
    userEmail: "teste@example.com",
    isSuperAdmin: false,
    organizationId: "org-1",
    membership: null,
    ...overrides,
  };
}

describe("can — RBAC (secção 3)", () => {
  it("superadministrador ultrapassa sempre a matriz, mesmo sem membership", () => {
    const ctx = context({ isSuperAdmin: true, membership: null });
    for (const action of ALL_ACTIONS) {
      expect(can(ctx, action)).toBe(true);
    }
  });

  it("sem membership e sem ser superadmin, nunca autoriza nada", () => {
    const ctx = context({ membership: null });
    for (const action of ALL_ACTIONS) {
      expect(can(ctx, action)).toBe(false);
    }
  });

  it("ORG_ADMIN autoriza todas as ações", () => {
    const ctx = context({ membership: membership("ORG_ADMIN") });
    for (const action of ALL_ACTIONS) {
      expect(can(ctx, action)).toBe(true);
    }
  });

  it("EDITOR só autoriza criar/editar/arquivar campanhas e ver estatísticas", () => {
    const ctx = context({ membership: membership("EDITOR") });
    expect(can(ctx, "campaign:create")).toBe(true);
    expect(can(ctx, "campaign:edit")).toBe(true);
    expect(can(ctx, "campaign:archive")).toBe(true);
    expect(can(ctx, "stats:view")).toBe(true);

    expect(can(ctx, "workspace:manage")).toBe(false);
    expect(can(ctx, "user:manage")).toBe(false);
    expect(can(ctx, "brand:manage")).toBe(false);
    expect(can(ctx, "campaign:delete")).toBe(false);
    expect(can(ctx, "leads:view")).toBe(false);
    expect(can(ctx, "leads:export")).toBe(false);
    expect(can(ctx, "audit:view")).toBe(false);
  });

  it("EDITOR só publica quando canPublish está ativo — não basta ter o papel", () => {
    const withoutFlag = context({ membership: membership("EDITOR", { canPublish: false }) });
    const withFlag = context({ membership: membership("EDITOR", { canPublish: true }) });
    expect(can(withoutFlag, "campaign:publish")).toBe(false);
    expect(can(withFlag, "campaign:publish")).toBe(true);
  });

  it("ANALYST vê leads/estatísticas mas só exporta quando canExportLeads está ativo", () => {
    const withoutFlag = context({ membership: membership("ANALYST", { canExportLeads: false }) });
    const withFlag = context({ membership: membership("ANALYST", { canExportLeads: true }) });

    expect(can(withoutFlag, "leads:view")).toBe(true);
    expect(can(withoutFlag, "stats:view")).toBe(true);
    expect(can(withoutFlag, "leads:export")).toBe(false);
    expect(can(withFlag, "leads:export")).toBe(true);

    expect(can(withoutFlag, "campaign:create")).toBe(false);
    expect(can(withoutFlag, "campaign:edit")).toBe(false);
    expect(can(withoutFlag, "campaign:publish")).toBe(false);
    expect(can(withoutFlag, "campaign:delete")).toBe(false);
    expect(can(withoutFlag, "workspace:manage")).toBe(false);
    expect(can(withoutFlag, "user:manage")).toBe(false);
  });

  it("VIEWER só consulta leads/estatísticas — nunca edita nem exporta, mesmo com canExportLeads=true", () => {
    // O bypass de leads:export só existe para o papel ANALYST — um VIEWER
    // nunca deve conseguir exportar, mesmo que a flag esteja (indevidamente)
    // definida na BD.
    const ctx = context({ membership: membership("VIEWER", { canExportLeads: true, canPublish: true }) });

    expect(can(ctx, "leads:view")).toBe(true);
    expect(can(ctx, "stats:view")).toBe(true);
    expect(can(ctx, "leads:export")).toBe(false);
    expect(can(ctx, "campaign:publish")).toBe(false);
    expect(can(ctx, "campaign:create")).toBe(false);
    expect(can(ctx, "campaign:edit")).toBe(false);
    expect(can(ctx, "campaign:archive")).toBe(false);
    expect(can(ctx, "campaign:delete")).toBe(false);
    expect(can(ctx, "workspace:manage")).toBe(false);
    expect(can(ctx, "user:manage")).toBe(false);
    expect(can(ctx, "brand:manage")).toBe(false);
    expect(can(ctx, "audit:view")).toBe(false);
  });
});

describe("assertCan", () => {
  it("não lança quando a ação é permitida", () => {
    const ctx = context({ membership: membership("ORG_ADMIN") });
    expect(() => assertCan(ctx, "campaign:delete")).not.toThrow();
  });

  it("lança PermissionDeniedError quando a ação não é permitida", () => {
    const ctx = context({ membership: membership("VIEWER") });
    expect(() => assertCan(ctx, "campaign:delete")).toThrow(PermissionDeniedError);
  });
});
