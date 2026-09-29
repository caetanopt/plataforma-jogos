import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";

/**
 * O token só diz quem é: o estado do utilizador e da organização vem sempre
 * da base de dados (resolveOrgContext com o módulo real; só a sessão do
 * Auth.js é substituída).
 */

const session = vi.hoisted(() => ({
  user: null as null | { id: string; isSuperAdmin: boolean; activeOrganizationId: string | null },
}));
vi.mock("@/server/auth", () => ({
  auth: async () => (session.user ? { user: { ...session.user, name: "x", email: "x@example.com" } } : null),
}));

const { resolveOrgContext } = await import("@/server/auth/session");

const cleanups: Array<() => Promise<void>> = [];

async function member(options: { isActive?: boolean; isSuperAdmin?: boolean; suspended?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Ctx ${suffix}`, slug: `ctx-${suffix}`, suspendedAt: options.suspended ? new Date() : null },
  });
  const user = await prisma.user.create({
    data: {
      name: "Ctx",
      email: `ctx-${suffix}@example.com`,
      passwordHash: "x",
      isActive: options.isActive ?? true,
      isSuperAdmin: options.isSuperAdmin ?? false,
    },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "EDITOR" } });
  cleanups.push(async () => {
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });
  return { user, organization };
}

afterEach(async () => {
  session.user = null;
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("resolveOrgContext", () => {
  it("um superadmin revogado na BD deixa de o ser, mesmo com o token a dizer que é", async () => {
    const { user, organization } = await member({ isSuperAdmin: false });
    session.user = { id: user.id, isSuperAdmin: true, activeOrganizationId: organization.id };

    const result = await resolveOrgContext();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.isSuperAdmin).toBe(false);
  });

  it("um utilizador desativado perde a sessão no pedido seguinte", async () => {
    const { user, organization } = await member({ isActive: false });
    session.user = { id: user.id, isSuperAdmin: false, activeOrganizationId: organization.id };

    expect(await resolveOrgContext()).toEqual({ ok: false, reason: "no_session" });
  });

  it("os membros de uma organização suspensa ficam sem acesso", async () => {
    const { user, organization } = await member({ suspended: true });
    session.user = { id: user.id, isSuperAdmin: false, activeOrganizationId: organization.id };

    expect(await resolveOrgContext()).toEqual({ ok: false, reason: "suspended" });
  });

  it("sem sessão", async () => {
    expect(await resolveOrgContext()).toEqual({ ok: false, reason: "no_session" });
  });
});
