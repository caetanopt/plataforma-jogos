import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getCampaignForEditor, listCampaigns } from "@/features/campaigns/queries";
import { listLeads } from "@/features/leads/queries";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function createOrgWithCampaign() {
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
      internalName: `Campanha ${suffix}`,
      ownerId: user.id,
      slug: `campanha-teste-${suffix}`,
      memoryConfig: { create: {} },
    },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });
  const participant = await prisma.participant.create({
    data: { organizationId: organization.id, cookieId: `cookie-${suffix}`, email: `lead-${suffix}@example.com` },
  });
  const participation = await prisma.participation.create({
    data: {
      campaignId: campaign.id,
      campaignVersionId: version.id,
      participantId: participant.id,
      idempotencyKey: randomUUID(),
    },
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

  return { organizationId: organization.id, campaignId: campaign.id, participationId: participation.id, cleanup };
}

describe("Isolamento multi-tenant nas queries de leitura", () => {
  it("getCampaignForEditor nunca devolve a campanha de outra organização, mesmo com o id certo", async () => {
    const orgA = await createOrgWithCampaign();
    const orgB = await createOrgWithCampaign();
    try {
      expect(await getCampaignForEditor(orgA.organizationId, orgA.campaignId)).not.toBeNull();
      expect(await getCampaignForEditor(orgA.organizationId, orgB.campaignId)).toBeNull();
      expect(await getCampaignForEditor(orgB.organizationId, orgA.campaignId)).toBeNull();
    } finally {
      await orgA.cleanup();
      await orgB.cleanup();
    }
  }, 30_000);

  it("listCampaigns nunca inclui campanhas de outra organização", async () => {
    const orgA = await createOrgWithCampaign();
    const orgB = await createOrgWithCampaign();
    try {
      const { items } = await listCampaigns(orgA.organizationId, {});
      const ids = items.map((c) => c.id);
      expect(ids).toContain(orgA.campaignId);
      expect(ids).not.toContain(orgB.campaignId);
    } finally {
      await orgA.cleanup();
      await orgB.cleanup();
    }
  }, 30_000);

  it("listLeads nunca inclui participações/leads de outra organização", async () => {
    const orgA = await createOrgWithCampaign();
    const orgB = await createOrgWithCampaign();
    try {
      const allTime = { preset: "all" as const, from: new Date(0), to: new Date() };
      const { items } = await listLeads(orgA.organizationId, allTime, {});
      const ids = items.map((p) => p.id);
      expect(ids).toContain(orgA.participationId);
      expect(ids).not.toContain(orgB.participationId);
    } finally {
      await orgA.cleanup();
      await orgB.cleanup();
    }
  }, 30_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});
