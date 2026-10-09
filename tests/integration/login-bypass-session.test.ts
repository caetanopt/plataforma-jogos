import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * A sessão de quem entra sem login, com o `auth()` de src/server/auth a sério
 * e o ambiente de um deploy de produção do Vercel. Substitui-se o Auth.js (não
 * corre fora do runtime do Next) e os headers do pedido.
 */

const realSession = vi.hoisted(() => ({ marker: { user: { id: "sessao-real" } } }));
const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next-auth", () => ({
  default: () => ({
    handlers: {},
    signIn: async () => {},
    signOut: async () => {},
    auth: async () => realSession.marker,
  }),
  AuthError: class AuthError extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: () => ({}) }));

const PRODUCTION_DOMAIN = "jogos.caetano.test";
// O modo é decidido ao carregar o módulo: o ambiente tem de estar pronto antes.
vi.stubEnv("VERCEL", "1");
vi.stubEnv("VERCEL_ENV", "production");
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", PRODUCTION_DOMAIN);

const { LOGIN_DISABLED_IN_PRODUCTION } = await import("@/server/auth/bypass");
const { auth } = await import("@/server/auth");
const { prisma } = await import("@/server/db/client");

function requestTo(host: string) {
  headersMock.mockResolvedValue(new Headers({ host }));
}

const cleanups: Array<() => Promise<void>> = [];

async function superAdmin(withMembership: boolean) {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      name: "Super",
      email: `bypass-${suffix}@example.com`,
      passwordHash: "x",
      isSuperAdmin: true,
    },
  });
  let organizationId: string | null = null;
  if (withMembership) {
    const organization = await prisma.organization.create({
      data: { name: `Bypass ${suffix}`, slug: `bypass-${suffix}` },
    });
    organizationId = organization.id;
    await prisma.membership.create({
      data: { userId: user.id, organizationId, role: "ORG_ADMIN" },
    });
  }
  cleanups.push(async () => {
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    if (organizationId) await prisma.organization.delete({ where: { id: organizationId } });
  });
  // O bypass entra como o utilizador ativo mais antigo; na base de testes não
  // se controla qual é, por isso aponta-se a este.
  vi.spyOn(prisma.user, "findFirst").mockResolvedValueOnce(user);
  return { user, organizationId };
}

afterEach(async () => {
  vi.restoreAllMocks();
  headersMock.mockReset();
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe.runIf(LOGIN_DISABLED_IN_PRODUCTION)("auth() com o login desligado em produção", () => {
  it("pelo domínio de produção, entra como o utilizador mais antigo, na organização dele", async () => {
    const { user, organizationId } = await superAdmin(true);
    requestTo(PRODUCTION_DOMAIN);

    const session = await auth();

    expect(session?.user).toMatchObject({
      id: user.id,
      isSuperAdmin: true,
      activeOrganizationId: organizationId,
    });
  });

  it("um superadmin sem membership fica na organização mais antiga, em vez de sem nenhuma", async () => {
    const { user } = await superAdmin(false);
    const oldest = await prisma.organization.findFirstOrThrow({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    requestTo(PRODUCTION_DOMAIN);

    const session = await auth();

    expect(session?.user).toMatchObject({ id: user.id, activeOrganizationId: oldest.id });
  });

  it("pelo URL próprio de um deploy, usa a sessão real (pede login)", async () => {
    const findFirst = vi.spyOn(prisma.user, "findFirst");
    requestTo("plataforma-jogos-3oigidd52-caetanopt.vercel.app");

    const session = await auth();

    expect(session).toBe(realSession.marker);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
