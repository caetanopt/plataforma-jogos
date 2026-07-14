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
        _count: { select: { participations: true } },
      },
    }),
    prisma.campaign.count({ where }),
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function getCampaignForEditor(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({
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
      _count: { select: { participations: true } },
    },
  });
}

export type CampaignForEditor = NonNullable<Awaited<ReturnType<typeof getCampaignForEditor>>>;
