import { prisma } from "@/server/db/client";
import { Prisma, type CampaignType } from "@/generated/prisma/client";

/**
 * Alertas operacionais e contagens por estado das campanhas.
 *
 * Substitui a parte exclusiva do antigo `getDashboardMetrics`: as métricas de
 * volume (visualizações, participações, leads, conversão) já vinham duplicadas
 * de `getCampaignStats` e foram descartadas na migração para /analytics.
 *
 * Nada aqui depende do intervalo de datas selecionado. Um alerta responde a
 * "o que exige atenção agora" — uma campanha que termina amanhã tem de
 * aparecer mesmo com o filtro em "Hoje", e o stock de um prémio é o stock
 * atual, não o stock durante o período escolhido. As contagens por estado são,
 * pela mesma razão, o retrato presente do portefólio.
 */

export interface CampaignAlertsFilters {
  campaignId?: string;
  workspaceId?: string;
  folderId?: string;
  type?: CampaignType;
}

/** Restante igual ou inferior a este valor dispara alerta de stock. */
export const STOCK_ALERT_THRESHOLD = 5;

/** Janela, em dias, para considerar que uma campanha "termina brevemente". */
export const ENDING_SOON_WINDOW_DAYS = 3;

export interface EndingSoonCampaign {
  id: string;
  internalName: string;
  scheduleEndAt: Date | null;
}

export interface StockAlert {
  id: string;
  campaignId: string;
  publicName: string;
  remaining: number;
}

export interface CampaignAlerts {
  published: number;
  drafts: number;
  scheduled: number;
  paused: number;
  endingSoon: EndingSoonCampaign[];
  stockAlerts: StockAlert[];
}

export async function getCampaignAlerts(
  organizationId: string,
  filters: CampaignAlertsFilters,
  now: Date = new Date(),
): Promise<CampaignAlerts> {
  // Isolamento multi-tenant: tudo parte de organizationId. Os prémios são
  // alcançados pelos ids das campanhas desta organização, nunca consultados
  // diretamente.
  const campaignWhere: Prisma.CampaignWhereInput = {
    organizationId,
    ...(filters.campaignId ? { id: filters.campaignId } : {}),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  const endOfWindow = new Date(now.getTime() + ENDING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [statusCounts, campaigns, endingSoon] = await Promise.all([
    prisma.campaign.groupBy({ by: ["status"], where: campaignWhere, _count: { _all: true } }),
    prisma.campaign.findMany({ where: campaignWhere, select: { id: true } }),
    prisma.campaign.findMany({
      where: {
        ...campaignWhere,
        status: "PUBLISHED",
        scheduleEndAt: { gte: now, lte: endOfWindow },
      },
      orderBy: { scheduleEndAt: "asc" },
      select: { id: true, internalName: true, scheduleEndAt: true },
    }),
  ]);

  const statusCountMap = new Map(statusCounts.map((row) => [row.status, row._count._all]));

  const prizesWithStock = await prisma.prize.findMany({
    where: {
      campaignId: { in: campaigns.map((campaign) => campaign.id) },
      isActive: true,
      totalQuantity: { not: null },
    },
    select: {
      id: true,
      campaignId: true,
      publicName: true,
      totalQuantity: true,
      awardedQuantity: true,
    },
  });

  const stockAlerts = prizesWithStock
    .map((prize) => ({
      id: prize.id,
      campaignId: prize.campaignId,
      publicName: prize.publicName,
      // O restante é calculado aqui, uma vez, em vez de repetido no JSX.
      remaining: Math.max(0, (prize.totalQuantity ?? 0) - prize.awardedQuantity),
    }))
    .filter((prize) => prize.remaining <= STOCK_ALERT_THRESHOLD)
    .sort((a, b) => a.remaining - b.remaining);

  return {
    published: statusCountMap.get("PUBLISHED") ?? 0,
    drafts: statusCountMap.get("DRAFT") ?? 0,
    scheduled: statusCountMap.get("SCHEDULED") ?? 0,
    paused: statusCountMap.get("PAUSED") ?? 0,
    endingSoon,
    stockAlerts,
  };
}
