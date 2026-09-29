import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { DateRange } from "@/lib/dates/range";

export interface LeadsFilters {
  campaignId?: string;
  search?: string;
  excludeTest?: boolean;
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 20;

function buildWhere(
  organizationId: string,
  range: DateRange,
  filters: LeadsFilters,
): Prisma.ParticipationWhereInput {
  // Os telefones estão gravados só com dígitos (normalizePhone): "912 345
  // 678" na pesquisa tem de encontrar "912345678".
  const looksLikePhone = /^[\d\s+().-]+$/.test(filters.search ?? "");
  const searchDigits = looksLikePhone ? (filters.search ?? "").replace(/[^0-9]/g, "") : "";
  return {
    campaign: { organizationId },
    ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    ...(filters.excludeTest !== false ? { isTest: false } : {}),
    createdAt: { gte: range.from, lte: range.to },
    ...(filters.search
      ? {
          // A identidade de cada lead é a da participação (ver identity.ts).
          OR: [
            { email: { contains: filters.search, mode: "insensitive" } },
            { phone: { contains: filters.search, mode: "insensitive" } },
            ...(searchDigits.length >= 3 ? [{ phone: { contains: searchDigits } }] : []),
            { firstName: { contains: filters.search, mode: "insensitive" } },
            { lastName: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

export async function listLeads(organizationId: string, range: DateRange, filters: LeadsFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildWhere(organizationId, range, filters);

  const [items, total] = await Promise.all([
    prisma.participation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        campaign: { select: { id: true, internalName: true, type: true } },
        prizeAward: { include: { prize: true, prizeCode: true } },
      },
    }),
    prisma.participation.count({ where }),
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listLeadsForExport(organizationId: string, range: DateRange, filters: LeadsFilters) {
  const where = buildWhere(organizationId, range, filters);
  return prisma.participation.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      campaign: { select: { internalName: true, type: true } },
      prizeAward: { include: { prize: true, prizeCode: true } },
    },
  });
}
