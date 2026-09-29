import { Redis } from "ioredis";
import { hashPassword } from "../../src/lib/security/password";
import { disconnectPrisma, getPrisma } from "./db.mts";

/**
 * Conta própria da suite, nunca a do superadmin real. Antes era a do seed
 * (marketing@caetano.pt): correr a suite com um .env a apontar para
 * produção punha a password do superadmin real igual à que está escrita
 * neste ficheiro.
 */
export const E2E_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "e2e-admin@example.test";
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2eSuite!Passw0rd";
export const E2E_ORG_SLUG = "caetano";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * A suite escreve na base de dados e no Redis do .env: cria organizações e
 * campanhas, repõe a password da sua conta e apaga as chaves de rate limit.
 * Só corre contra serviços locais (a máquina de desenvolvimento ou os
 * contentores do CI). Para outra máquina de testes dedicada, definir
 * E2E_ALLOW_REMOTE_SERVICES=true de propósito.
 */
function assertLocalService(name: string, url: string | undefined): void {
  if (process.env.E2E_ALLOW_REMOTE_SERVICES === "true") return;
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (!host || !LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[e2e] ${name} não aponta para um serviço local (${host ?? "sem URL"}). ` +
        "A suite escreve dados e repõe passwords: recusa correr fora de localhost. " +
        "Para uma máquina de testes dedicada, defina E2E_ALLOW_REMOTE_SERVICES=true.",
    );
  }
}

/**
 * Garante um administrador com password conhecida para a suite e2e,
 * independentemente da password aleatória gerada por `prisma/seed.ts`.
 * Cria a organização/espaço de trabalho/pasta se ainda não existirem,
 * para a suite não depender de `npm run db:seed` ter corrido antes.
 */
export default async function globalSetup(): Promise<void> {
  assertLocalService("DATABASE_URL", process.env.DATABASE_URL);
  assertLocalService("REDIS_URL", process.env.REDIS_URL ?? "redis://localhost:6379");

  const prisma = await getPrisma();

  const organization = await prisma.organization.upsert({
    where: { slug: E2E_ORG_SLUG },
    update: {},
    create: {
      name: "Caetano",
      slug: E2E_ORG_SLUG,
      privacyContactEmail: "privacidade@caetano.pt",
      defaultTimezone: "Europe/Lisbon",
    },
  });

  const passwordHash = await hashPassword(E2E_ADMIN_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: E2E_ADMIN_EMAIL },
    update: { passwordHash },
    create: {
      name: "Administrador e2e",
      email: E2E_ADMIN_EMAIL,
      passwordHash,
      isSuperAdmin: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: { role: "ORG_ADMIN" },
    create: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN" },
  });

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: E2E_ORG_SLUG } },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Caetano",
      slug: E2E_ORG_SLUG,
      description: "Espaço de trabalho principal do grupo Caetano.",
    },
  });

  await prisma.folder.upsert({
    where: { id: `${workspace.id}-default` },
    update: {},
    create: { id: `${workspace.id}-default`, workspaceId: workspace.id, name: "Campanhas" },
  });

  await disconnectPrisma();

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const rateLimitKeys = await redis.keys("ratelimit:*");
  if (rateLimitKeys.length) await redis.del(...rateLimitKeys);
  redis.disconnect();
}
