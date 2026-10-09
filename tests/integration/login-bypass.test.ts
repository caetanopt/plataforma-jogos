import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Com o login desligado (ver src/server/auth/bypass.ts), a gestão de
 * utilizadores fica bloqueada no servidor: um convite ou um papel mudado
 * continuava a valer depois de o login voltar, e quem os fazia era qualquer
 * pessoa com o link. Substitui-se a sessão, o cache do Next e o e-mail.
 */

const state = vi.hoisted(() => ({ context: null as OrgContext | null, bypassed: false }));

vi.mock("@/server/auth/session", () => ({
  requireOrgContext: async () => {
    if (!state.context) throw new Error("Sem sessão de teste.");
    return state.context;
  },
}));
vi.mock("@/server/auth/bypass", () => ({ isLoginBypassed: async () => state.bypassed }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/mail/mailer", () => ({
  MailDeliveryError: class extends Error {},
  sendMail: async () => {},
}));

const { inviteUserAction, updateMembershipAction, removeMembershipAction } =
  await import("@/features/users/actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** O destino de um `redirect()` do Next (que se lança como erro). */
async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "(sem redirect)";
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT")
      ? (digest.split(";")[2] ?? "")
      : `erro: ${String(error)}`;
  }
}

const suffix = randomUUID().slice(0, 8);
let organizationId = "";
let adminMembershipId = "";
let memberMembershipId = "";
const invitedEmails: string[] = [];

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: `Login off ${suffix}`, slug: `login-off-${suffix}` },
  });
  organizationId = organization.id;
  const admin = await prisma.user.create({
    data: { name: "Admin", email: `login-off-admin-${suffix}@example.com`, passwordHash: "x" },
  });
  const member = await prisma.user.create({
    data: { name: "Membro", email: `login-off-member-${suffix}@example.com`, passwordHash: "x" },
  });
  adminMembershipId = (
    await prisma.membership.create({
      data: { userId: admin.id, organizationId, role: "ORG_ADMIN" },
    })
  ).id;
  memberMembershipId = (
    await prisma.membership.create({ data: { userId: member.id, organizationId, role: "VIEWER" } })
  ).id;
  state.context = {
    userId: admin.id,
    userName: "Admin",
    userEmail: admin.email,
    isSuperAdmin: false,
    organizationId,
    membership: await prisma.membership.findUniqueOrThrow({ where: { id: adminMembershipId } }),
  };
});

afterEach(() => {
  state.bypassed = false;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    select: { userId: true },
  });
  await prisma.membership.deleteMany({ where: { organizationId } });
  const userIds = memberships.map((membership) => membership.userId);
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { email: { in: invitedEmails } } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe("gestão de utilizadores com o login desligado", () => {
  it("recusa um convite, sem criar utilizador nem token", async () => {
    state.bypassed = true;
    const email = `login-off-convidado-${suffix}@example.com`;
    invitedEmails.push(email);

    const target = await redirectTarget(
      inviteUserAction(form({ name: "Convidado", email, role: "ORG_ADMIN" })),
    );

    expect(target).toBe("/users?error=login_disabled");
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("recusa mudar um papel", async () => {
    state.bypassed = true;

    const target = await redirectTarget(
      updateMembershipAction(form({ membershipId: memberMembershipId, role: "ORG_ADMIN" })),
    );

    expect(target).toBe("/users?error=login_disabled");
    expect(
      (await prisma.membership.findUniqueOrThrow({ where: { id: memberMembershipId } })).role,
    ).toBe("VIEWER");
  });

  it("recusa remover um membro", async () => {
    state.bypassed = true;

    const target = await redirectTarget(
      removeMembershipAction(form({ membershipId: memberMembershipId })),
    );

    expect(target).toBe("/users?error=login_disabled");
    expect(await prisma.membership.count({ where: { id: memberMembershipId } })).toBe(1);
  });

  it("com o login ligado, o convite funciona como antes", async () => {
    const email = `login-on-convidado-${suffix}@example.com`;
    invitedEmails.push(email);

    const target = await redirectTarget(
      inviteUserAction(form({ name: "Convidado", email, role: "VIEWER" })),
    );

    expect(target).toBe("(sem redirect)");
    expect(await prisma.membership.count({ where: { organizationId, user: { email } } })).toBe(1);
  });
});
