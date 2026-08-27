import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createParticipationIfAllowed } from "@/features/play/create-participation";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function createCampaignFixture() {
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: { name: `Teste ${suffix}`, slug: `teste-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `teste-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Teste", slug: `teste-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "MEMORY",
      internalName: "Memória de teste",
      ownerId: user.id,
      slug: `memoria-teste-${suffix}`,
      participationLimitType: "ONE_TOTAL",
      memoryConfig: { create: {} },
    },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });

  const cleanup = async () => {
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.participant.deleteMany({ where: { organizationId: organization.id } });
    await prisma.memoryGameConfig.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    versionId: version.id,
    cleanup,
  };
}

describe("createParticipationIfAllowed — concorrência nos limites de participação", () => {
  it("permite apenas uma participação (ONE_TOTAL) a partir do mesmo visitante, mesmo com pedidos concorrentes", async () => {
    const fixture = await createCampaignFixture();
    try {
      const cookieId = `visitante-${randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          createParticipationIfAllowed({
            organizationId: fixture.organizationId,
            campaignId: fixture.campaignId,
            campaignVersionId: fixture.versionId,
            campaignType: "MEMORY",
            participationLimitType: "ONE_TOTAL",
            participationCustomMax: null,
            dedupStrategies: [],
            quizMaxAttempts: null,
            idempotencyKey: randomUUID(),
            isTest: false,
            cookieId,
            ip: null,
            sessionId: randomUUID(),
            deviceType: null,
            browser: null,
            os: null,
          }),
        ),
      );

      const created = results.filter((r) => r.kind === "created");
      const blocked = results.filter((r) => r.kind === "blocked");
      expect(created.length).toBe(1);
      expect(blocked.length).toBe(7);

      const count = await prisma.participation.count({ where: { campaignId: fixture.campaignId } });
      expect(count).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("permite exatamente CUSTOM_MAX participações a partir do mesmo visitante (limite 3, 10 pedidos)", async () => {
    const fixture = await createCampaignFixture();
    try {
      const cookieId = `visitante-${randomUUID()}`;

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          createParticipationIfAllowed({
            organizationId: fixture.organizationId,
            campaignId: fixture.campaignId,
            campaignVersionId: fixture.versionId,
            campaignType: "MEMORY",
            participationLimitType: "CUSTOM_MAX",
            participationCustomMax: 3,
            dedupStrategies: [],
            quizMaxAttempts: null,
            idempotencyKey: randomUUID(),
            isTest: false,
            cookieId,
            ip: null,
            sessionId: randomUUID(),
            deviceType: null,
            browser: null,
            os: null,
          }),
        ),
      );

      const created = results.filter((r) => r.kind === "created");
      expect(created.length).toBe(3);

      const count = await prisma.participation.count({ where: { campaignId: fixture.campaignId } });
      expect(count).toBe(3);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("visitantes diferentes (cookies diferentes) não se bloqueiam uns aos outros", async () => {
    const fixture = await createCampaignFixture();
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createParticipationIfAllowed({
            organizationId: fixture.organizationId,
            campaignId: fixture.campaignId,
            campaignVersionId: fixture.versionId,
            campaignType: "MEMORY",
            participationLimitType: "ONE_TOTAL",
            participationCustomMax: null,
            dedupStrategies: [],
            quizMaxAttempts: null,
            idempotencyKey: randomUUID(),
            isTest: false,
            cookieId: `visitante-${randomUUID()}`,
            ip: null,
            sessionId: randomUUID(),
            deviceType: null,
            browser: null,
            os: null,
          }),
        ),
      );

      expect(results.every((r) => r.kind === "created")).toBe(true);

      const count = await prisma.participation.count({ where: { campaignId: fixture.campaignId } });
      expect(count).toBe(5);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("é idempotente: repetir o mesmo idempotencyKey devolve a mesma participação sem contar para o limite", async () => {
    const fixture = await createCampaignFixture();
    try {
      const cookieId = `visitante-${randomUUID()}`;
      const idempotencyKey = randomUUID();

      const first = await createParticipationIfAllowed({
        organizationId: fixture.organizationId,
        campaignId: fixture.campaignId,
        campaignVersionId: fixture.versionId,
        campaignType: "MEMORY",
        participationLimitType: "ONE_TOTAL",
        participationCustomMax: null,
        dedupStrategies: [],
        quizMaxAttempts: null,
        idempotencyKey,
        isTest: false,
        cookieId,
        ip: null,
        sessionId: randomUUID(),
        deviceType: null,
        browser: null,
        os: null,
      });
      expect(first.kind).toBe("created");

      const second = await createParticipationIfAllowed({
        organizationId: fixture.organizationId,
        campaignId: fixture.campaignId,
        campaignVersionId: fixture.versionId,
        campaignType: "MEMORY",
        participationLimitType: "ONE_TOTAL",
        participationCustomMax: null,
        dedupStrategies: [],
        quizMaxAttempts: null,
        idempotencyKey,
        isTest: false,
        cookieId,
        ip: null,
        sessionId: randomUUID(),
        deviceType: null,
        browser: null,
        os: null,
      });
      expect(second.kind).toBe("existing");
      if (first.kind !== "blocked" && second.kind !== "blocked") {
        expect(second.participation.id).toBe(first.participation.id);
      }

      const count = await prisma.participation.count({ where: { campaignId: fixture.campaignId } });
      expect(count).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});
