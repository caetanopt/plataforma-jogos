import { prisma } from "@/server/db/client";
import { Prisma, type CampaignType } from "@/generated/prisma/client";
import type { DateRange } from "@/lib/dates/range";

export interface DashboardFilterInput {
  workspaceId?: string;
  folderId?: string;
  type?: CampaignType;
}

const STOCK_ALERT_THRESHOLD = 5;
const ENDING_SOON_WINDOW_DAYS = 3;

export async function getDashboardMetrics(
  organizationId: string,
  range: DateRange,
  filters: DashboardFilterInput,
) {
  const campaignWhere: Prisma.CampaignWhereInput = {
    organizationId,
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  const [statusCounts, campaigns] = await Promise.all([
    prisma.campaign.groupBy({ by: ["status"], where: campaignWhere, _count: { _all: true } }),
    prisma.campaign.findMany({ where: campaignWhere, select: { id: true } }),
  ]);

  const campaignIds = campaigns.map((c) => c.id);
  const statusCountMap = new Map(statusCounts.map((row) => [row.status, row._count._all]));

  const participationWhere: Prisma.ParticipationWhereInput = {
    campaignId: { in: campaignIds },
    isTest: false,
    createdAt: { gte: range.from, lte: range.to },
  };

  const [viewsCount, participationsCount, leadsCount, completedCount] = await Promise.all([
    prisma.analyticsEvent.count({
      where: {
        campaignId: { in: campaignIds },
        type: "CAMPAIGN_VIEWED",
        isTest: false,
        occurredAt: { gte: range.from, lte: range.to },
      },
    }),
    prisma.participation.count({ where: participationWhere }),
    prisma.participation.count({
      where: { ...participationWhere, leadFormResponse: { not: Prisma.JsonNull } },
    }),
    prisma.participation.count({ where: { ...participationWhere, status: "COMPLETED" } }),
  ]);

  const [recentCampaigns, activeCampaigns, endingSoon, prizesWithStock] = await Promise.all([
    prisma.campaign.findMany({
      where: campaignWhere,
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        internalName: true,
        publicTitle: true,
        type: true,
        status: true,
        updatedAt: true,
        slug: true,
      },
    }),
    prisma.campaign.findMany({
      where: { ...campaignWhere, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: { id: true, internalName: true, slug: true, scheduleEndAt: true },
    }),
    prisma.campaign.findMany({
      where: {
        ...campaignWhere,
        status: "PUBLISHED",
        scheduleEndAt: {
          gte: new Date(),
          lte: new Date(Date.now() + ENDING_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true, internalName: true, scheduleEndAt: true },
    }),
    prisma.prize.findMany({
      where: { campaignId: { in: campaignIds }, isActive: true, totalQuantity: { not: null } },
      select: { id: true, publicName: true, totalQuantity: true, awardedQuantity: true, campaignId: true },
    }),
  ]);

  const stockAlerts = prizesWithStock.filter(
    (prize) => (prize.totalQuantity ?? 0) - prize.awardedQuantity <= STOCK_ALERT_THRESHOLD,
  );

  return {
    published: statusCountMap.get("PUBLISHED") ?? 0,
    drafts: statusCountMap.get("DRAFT") ?? 0,
    scheduled: statusCountMap.get("SCHEDULED") ?? 0,
    paused: statusCountMap.get("PAUSED") ?? 0,
    views: viewsCount,
    participations: participationsCount,
    leads: leadsCount,
    completed: completedCount,
    conversionRate: viewsCount > 0 ? leadsCount / viewsCount : 0,
    completionRate: participationsCount > 0 ? completedCount / participationsCount : 0,
    recentCampaigns,
    activeCampaigns,
    endingSoon,
    stockAlerts,
  };
}
