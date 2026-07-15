import { Redis } from "ioredis";
import { hashPassword } from "../../src/lib/security/password";
import { disconnectPrisma, getPrisma } from "./db.mts";

export const E2E_ADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL ?? "marketing@caetano.pt";
export const E2E_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "E2eSuite!Passw0rd";
export const E2E_ORG_SLUG = "caetano";

/**
 * Garante um administrador com password conhecida para a suite e2e,
 * independentemente da password aleatória gerada por `prisma/seed.ts`.
 * Cria a organização/espaço de trabalho/pasta se ainda não existirem,
 * para a suite não depender de `npm run db:seed` ter corrido antes.
 */
export default async function globalSetup(): Promise<void> {
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
      name: "Administrador Caetano",
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
