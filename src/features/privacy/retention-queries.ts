import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  anonymizationDate,
  effectiveRetention,
  RETENTION_WARNING_DAYS,
  retentionCutoff,
  type EffectiveRetention,
} from "@/features/privacy/retention-policy";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A tarefa corre uma vez por dia: uma participação que passou o prazo há
 * mais de dois dias e continua com os dados quer dizer que a tarefa não está
 * a correr (CRON_SECRET por definir, por exemplo).
 */
export const RETENTION_STALE_MS = 2 * DAY_MS;

export interface CampaignRetentionOutlook {
  campaignId: string;
  internalName: string;
  retention: EffectiveRetention;
  /** Serão anonimizadas nos próximos dias (RETENTION_WARNING_DAYS). */
  upcoming: number;
  /** Já deviam ter sido anonimizadas há mais de dois dias. */
  overdue: number;
  /** Quando sai a primeira delas. */
  nextAt: Date | null;
  /** A primeira já passou o prazo: sai na próxima execução da tarefa. */
  dueNow: boolean;
}

/**
 * O que o prazo de conservação vai anonimizar em breve, por campanha, para o
 * backoffice avisar antes (§24: "aviso antes da eliminação"). Uma só query
 * para todas as campanhas da organização com prazo.
 */
export async function retentionOutlook(
  organizationId: string,
  options: { campaignId?: string; now?: Date } = {},
): Promise<CampaignRetentionOutlook[]> {
  const now = options.now ?? new Date();
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId, ...(options.campaignId ? { id: options.campaignId } : {}) },
    select: {
      id: true,
      internalName: true,
      dataRetentionDays: true,
      dataRetentionUntil: true,
      organization: { select: { dataRetentionDays: true } },
    },
  });

  const soon = new Date(now.getTime() + RETENTION_WARNING_DAYS * DAY_MS);
  const stale = new Date(now.getTime() - RETENTION_STALE_MS);
  const windows = campaigns
    .map((campaign) => {
      const retention = effectiveRetention({ campaign, organizationDays: campaign.organization.dataRetentionDays });
      return { campaign, retention, upcomingBefore: retentionCutoff(retention, soon), overdueBefore: retentionCutoff(retention, stale) };
    })
    .filter((window) => window.upcomingBefore !== null);
  if (windows.length === 0) return [];

  // Sem data de corte "atrasada", um instante que nunca apanha nada.
  const never = new Date(0);
  const rows = await prisma.$queryRaw<Array<{ campaignId: string; upcoming: number; overdue: number; oldest: Date | null }>>`
    SELECT w."campaignId",
      COUNT(p."id")::int AS upcoming,
      COUNT(p."id") FILTER (WHERE p."createdAt" < w."overdueBefore")::int AS overdue,
      MIN(p."createdAt") AS oldest
    FROM (VALUES ${Prisma.join(
      windows.map(
        (window) =>
          Prisma.sql`(${window.campaign.id}, ${window.upcomingBefore}::timestamp(3), ${window.overdueBefore ?? never}::timestamp(3))`,
      ),
    )}) AS w("campaignId", "upcomingBefore", "overdueBefore")
    JOIN "Participation" p
      ON p."campaignId" = w."campaignId" AND p."anonymizedAt" IS NULL AND p."createdAt" < w."upcomingBefore"
    GROUP BY w."campaignId"`;

  const byCampaign = new Map(rows.map((row) => [row.campaignId, row]));
  return windows
    .map(({ campaign, retention }) => {
      const row = byCampaign.get(campaign.id);
      const nextAt = row?.oldest ? anonymizationDate(retention, row.oldest) : null;
      return {
        campaignId: campaign.id,
        internalName: campaign.internalName,
        retention,
        upcoming: row?.upcoming ?? 0,
        overdue: row?.overdue ?? 0,
        nextAt,
        dueNow: nextAt !== null && nextAt.getTime() <= now.getTime(),
      };
    })
    .filter((outlook) => outlook.upcoming > 0)
    .sort((a, b) => (a.nextAt?.getTime() ?? 0) - (b.nextAt?.getTime() ?? 0));
}

/**
 * A tarefa diária deixou de correr: há leads que passaram o prazo há mais
 * de dois dias, ou a última execução é antiga e há leads a sair em breve.
 */
export function isRetentionJobStale(
  outlook: readonly CampaignRetentionOutlook[],
  lastRun: { at: Date } | null,
  now: Date = new Date(),
): boolean {
  if (outlook.some((campaign) => campaign.overdue > 0)) return true;
  return outlook.length > 0 && lastRun !== null && now.getTime() - lastRun.at.getTime() > RETENTION_STALE_MS;
}
