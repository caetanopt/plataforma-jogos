import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  ENDING_SOON_WINDOW_DAYS,
  STOCK_ALERT_THRESHOLD,
  getCampaignAlerts,
} from "@/features/analytics/campaign-alerts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante fixo para não depender do relógio de quem corre os testes. */
const NOW = new Date("2026-06-15T12:00:00.000Z");

async function createOrg() {
  const suffix = randomUUID().slice(0, 8);

  const organization = await prisma.organization.create({
    data: { name: `Alertas ${suffix}`, slug: `alertas-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `alertas-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Teste", slug: `alertas-${suffix}` },
  });

  const campaignIds: string[] = [];

  async function addCampaign(data: {
    status?: "DRAFT" | "PUBLISHED" | "SCHEDULED" | "PAUSED";
    scheduleEndAt?: Date | null;
  }) {
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        type: "WHEEL",
        internalName: `Campanha ${campaignIds.length + 1} ${suffix}`,
        ownerId: user.id,
        slug: `alertas-${suffix}-${campaignIds.length + 1}`,
        status: data.status ?? "DRAFT",
        scheduleEndAt: data.scheduleEndAt ?? null,
      },
    });
    campaignIds.push(campaign.id);
    return campaign;
  }

  async function addPrize(campaignId: string, totalQuantity: number | null, awardedQuantity: number) {
    return prisma.prize.create({
      data: {
        campaignId,
        internalName: `Prémio ${randomUUID().slice(0, 6)}`,
        publicName: `Prémio ${randomUUID().slice(0, 6)}`,
        totalQuantity,
        awardedQuantity,
        isActive: true,
      },
    });
  }

  const cleanup = async () => {
    await prisma.prize.deleteMany({ where: { campaignId: { in: campaignIds } } });
    await prisma.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };

  return { organizationId: organization.id, addCampaign, addPrize, cleanup };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("getCampaignAlerts", () => {
  it("conta as campanhas por estado atual", async () => {
    const org = await createOrg();
    try {
      await org.addCampaign({ status: "PUBLISHED" });
      await org.addCampaign({ status: "PUBLISHED" });
      await org.addCampaign({ status: "DRAFT" });
      await org.addCampaign({ status: "SCHEDULED" });
      await org.addCampaign({ status: "PAUSED" });

      const alerts = await getCampaignAlerts(org.organizationId, {}, NOW);

      expect(alerts.published).toBe(2);
      expect(alerts.drafts).toBe(1);
      expect(alerts.scheduled).toBe(1);
      expect(alerts.paused).toBe(1);
    } finally {
      await org.cleanup();
    }
  }, 30_000);

  it("avisa apenas sobre campanhas publicadas que terminam dentro da janela", async () => {
    const org = await createOrg();
    try {
      const dentro = await org.addCampaign({
        status: "PUBLISHED",
        scheduleEndAt: new Date(NOW.getTime() + 1 * DAY_MS),
      });
      // Fora da janela de 3 dias.
      await org.addCampaign({
        status: "PUBLISHED",
        scheduleEndAt: new Date(NOW.getTime() + (ENDING_SOON_WINDOW_DAYS + 1) * DAY_MS),
      });
      // Já terminou: não é um alerta, é história.
      await org.addCampaign({
        status: "PUBLISHED",
        scheduleEndAt: new Date(NOW.getTime() - 1 * DAY_MS),
      });
      // Termina amanhã mas ainda é rascunho.
      await org.addCampaign({
        status: "DRAFT",
        scheduleEndAt: new Date(NOW.getTime() + 1 * DAY_MS),
      });

      const alerts = await getCampaignAlerts(org.organizationId, {}, NOW);

      expect(alerts.endingSoon.map((c) => c.id)).toEqual([dentro.id]);
    } finally {
      await org.cleanup();
    }
  }, 30_000);

  it("assinala stock no limiar e ignora prémios acima dele ou sem quantidade definida", async () => {
    const org = await createOrg();
    try {
      const campaign = await org.addCampaign({ status: "PUBLISHED" });

      const noLimiar = await org.addPrize(campaign.id, STOCK_ALERT_THRESHOLD + 10, 10);
      const esgotado = await org.addPrize(campaign.id, 4, 4);
      // Acima do limiar.
      await org.addPrize(campaign.id, 100, 0);
      // Quantidade ilimitada: nunca gera alerta de stock.
      await org.addPrize(campaign.id, null, 999);

      const alerts = await getCampaignAlerts(org.organizationId, {}, NOW);

      // Ordenado do mais crítico para o menos crítico.
      expect(alerts.stockAlerts.map((p) => p.id)).toEqual([esgotado.id, noLimiar.id]);
      expect(alerts.stockAlerts[0].remaining).toBe(0);
      expect(alerts.stockAlerts[1].remaining).toBe(STOCK_ALERT_THRESHOLD);
      expect(alerts.stockAlerts[0].campaignId).toBe(campaign.id);
    } finally {
      await org.cleanup();
    }
  }, 30_000);

  it("nunca mostra alertas nem contagens de outra organização", async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    try {
      const campaignB = await orgB.addCampaign({
        status: "PUBLISHED",
        scheduleEndAt: new Date(NOW.getTime() + 1 * DAY_MS),
      });
      await orgB.addPrize(campaignB.id, 1, 1);

      const alertsA = await getCampaignAlerts(orgA.organizationId, {}, NOW);

      expect(alertsA.published).toBe(0);
      expect(alertsA.endingSoon).toHaveLength(0);
      expect(alertsA.stockAlerts).toHaveLength(0);

      const alertsB = await getCampaignAlerts(orgB.organizationId, {}, NOW);
      expect(alertsB.endingSoon).toHaveLength(1);
      expect(alertsB.stockAlerts).toHaveLength(1);
    } finally {
      await orgA.cleanup();
      await orgB.cleanup();
    }
  }, 30_000);
});
