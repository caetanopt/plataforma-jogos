import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { drawAndAwardPrize, NoEligibleSegmentsError } from "@/features/wheel-game/draw";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function createWheelFixture(options: { prizeTotalQuantity: number; includeNoWinFallback: boolean }) {
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: { name: `Teste ${suffix}`, slug: `teste-${suffix}` },
  });
  const user = await prisma.user.create({
    data: {
      name: "Teste",
      email: `teste-${suffix}@example.com`,
      passwordHash: "test-hash",
    },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Teste", slug: `teste-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "WHEEL",
      internalName: "Roda de teste",
      ownerId: user.id,
      slug: `roda-teste-${suffix}`,
      wheelConfig: { create: {} },
    },
  });
  await prisma.campaignVersion.create({
    data: {
      campaignId: campaign.id,
      versionNumber: 1,
      snapshot: {},
      publishedById: user.id,
    },
  });
  const version = await prisma.campaignVersion.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });

  const prize = await prisma.prize.create({
    data: {
      campaignId: campaign.id,
      internalName: "Prémio escasso",
      publicName: "Prémio escasso",
      totalQuantity: options.prizeTotalQuantity,
    },
  });

  const wheelConfig = await prisma.wheelConfig.findUniqueOrThrow({ where: { campaignId: campaign.id } });

  await prisma.wheelSegment.create({
    data: {
      wheelConfigId: wheelConfig.id,
      order: 0,
      name: "Ganhou",
      colorHex: "#00AEEF",
      outcome: "WIN",
      prizeId: prize.id,
      weight: 1000,
      totalQuantity: options.prizeTotalQuantity,
      remainingQuantity: options.prizeTotalQuantity,
    },
  });

  if (options.includeNoWinFallback) {
    await prisma.wheelSegment.create({
      data: {
        wheelConfigId: wheelConfig.id,
        order: 1,
        name: "Não foi desta vez",
        colorHex: "#9CAEB8",
        outcome: "NO_WIN",
        weight: 1,
      },
    });
  }

  async function createParticipation() {
    return prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        idempotencyKey: randomUUID(),
      },
    });
  }

  const cleanup = async () => {
    await prisma.prizeAward.deleteMany({ where: { prize: { campaignId: campaign.id } } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.prizeCode.deleteMany({ where: { prize: { campaignId: campaign.id } } });
    await prisma.prize.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.wheelSegment.deleteMany({ where: { wheelConfigId: wheelConfig.id } });
    await prisma.wheelConfig.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };

  return { campaignId: campaign.id, prizeId: prize.id, cleanup, createParticipation };
}

describe("drawAndAwardPrize — concorrência e stock", () => {
  it("atribui um prémio com stock 1 a exatamente um de vários pedidos concorrentes", async () => {
    const fixture = await createWheelFixture({ prizeTotalQuantity: 1, includeNoWinFallback: true });
    try {
      const participations = await Promise.all(
        Array.from({ length: 8 }, () => fixture.createParticipation()),
      );

      const results = await Promise.all(participations.map((p) => drawAndAwardPrize(p.id)));

      const winners = results.filter((r) => r.outcome === "WIN");
      expect(winners.length).toBe(1);

      const prize = await prisma.prize.findUniqueOrThrow({ where: { id: fixture.prizeId } });
      expect(prize.awardedQuantity).toBe(1);

      const awards = await prisma.prizeAward.findMany({ where: { prizeId: fixture.prizeId } });
      expect(awards.length).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("nunca atribui mais prémios do que o stock disponível (stock 2, 10 pedidos)", async () => {
    const fixture = await createWheelFixture({ prizeTotalQuantity: 2, includeNoWinFallback: true });
    try {
      const participations = await Promise.all(
        Array.from({ length: 10 }, () => fixture.createParticipation()),
      );

      const results = await Promise.all(participations.map((p) => drawAndAwardPrize(p.id)));

      const winners = results.filter((r) => r.outcome === "WIN");
      expect(winners.length).toBe(2);

      const prize = await prisma.prize.findUniqueOrThrow({ where: { id: fixture.prizeId } });
      expect(prize.awardedQuantity).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("é idempotente: repetir o pedido para a mesma participação devolve o mesmo resultado sem sortear de novo", async () => {
    const fixture = await createWheelFixture({ prizeTotalQuantity: 1, includeNoWinFallback: false });
    try {
      const participation = await fixture.createParticipation();

      const first = await drawAndAwardPrize(participation.id);
      expect(first.alreadyResolved).toBe(false);
      expect(first.outcome).toBe("WIN");

      const second = await drawAndAwardPrize(participation.id);
      expect(second.alreadyResolved).toBe(true);
      expect(second.segmentId).toBe(first.segmentId);
      expect(second.prize?.code).toBe(first.prize?.code);

      const prize = await prisma.prize.findUniqueOrThrow({ where: { id: fixture.prizeId } });
      expect(prize.awardedQuantity).toBe(1);

      const awards = await prisma.prizeAward.findMany({ where: { prizeId: fixture.prizeId } });
      expect(awards.length).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it("lança NoEligibleSegmentsError quando não há segmentos elegíveis (stock esgotado, sem fallback)", async () => {
    const fixture = await createWheelFixture({ prizeTotalQuantity: 1, includeNoWinFallback: false });
    try {
      const first = await fixture.createParticipation();
      const second = await fixture.createParticipation();

      await drawAndAwardPrize(first.id);
      await expect(drawAndAwardPrize(second.id)).rejects.toBeInstanceOf(NoEligibleSegmentsError);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});
