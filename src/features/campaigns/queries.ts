import { cache } from "react";
import { prisma } from "@/server/db/client";
import { Prisma, type CampaignStatus, type CampaignType } from "@/generated/prisma/client";

export interface ListCampaignsFilters {
  search?: string;
  status?: CampaignStatus;
  type?: CampaignType;
  workspaceId?: string;
  folderId?: string;
  authorId?: string;
  page?: number;
  pageSize?: number;
  sort?: "updated_desc" | "created_desc" | "name_asc";
}

const DEFAULT_PAGE_SIZE = 12;

export async function listCampaigns(organizationId: string, filters: ListCampaignsFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where: Prisma.CampaignWhereInput = {
    organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.authorId ? { ownerId: filters.authorId } : {}),
    ...(filters.search
      ? {
          OR: [
            { internalName: { contains: filters.search, mode: "insensitive" } },
            { publicTitle: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.CampaignOrderByWithRelationInput =
    filters.sort === "created_desc"
      ? { createdAt: "desc" }
      : filters.sort === "name_asc"
        ? { internalName: "asc" }
        : { updatedAt: "desc" };

  const [items, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        folder: { select: { id: true, name: true } },
        workspace: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  // Contagem só das campanhas desta página. O `_count` do Prisma fazia um
  // GROUP BY sobre a tabela Participation inteira (todas as organizações) a
  // cada listagem.
  const counts = await countParticipationsByCampaign(items.map((item) => item.id));
  const withCounts = items.map((item) => ({ ...item, _count: { participations: counts.get(item.id) ?? 0 } }));

  return { items: withCounts, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function countParticipationsByCampaign(campaignIds: string[]): Promise<Map<string, number>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await prisma.participation.groupBy({
    by: ["campaignId"],
    where: { campaignId: { in: campaignIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.campaignId, row._count._all]));
}

/**
 * A campanha com tudo o que o editor mostra. Com `cache`, o layout e a
 * página da mesma navegação partilham a leitura (eram ~17 queries cada).
 */
export const getCampaignForEditor = cache(async (organizationId: string, campaignId: string) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: {
      workspace: true,
      folder: true,
      theme: true,
      leadForm: { include: { fields: { orderBy: { order: "asc" } }, consentDefinitions: true } },
      screens: true,
      memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } },
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      quizConfig: {
        include: {
          questions: { include: { answers: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          resultProfiles: true,
        },
      },
      prizes: true,
    },
  });
  if (!campaign) return null;
  // Só se há alguma, sem contar todas (antes: GROUP BY na tabela inteira).
  const anyParticipation = await prisma.participation.findFirst({
    where: { campaignId: campaign.id },
    select: { id: true },
  });
  return { ...campaign, hasParticipations: anyParticipation !== null };
});

export type CampaignForEditor = NonNullable<Awaited<ReturnType<typeof getCampaignForEditor>>>;
