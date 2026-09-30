import { prisma } from "@/server/db/client";
import { logAudit } from "@/server/audit/log";
import { anonymizeCampaignBefore } from "@/features/privacy/anonymize";
import { effectiveRetention, retentionCutoff, type EffectiveRetention } from "@/features/privacy/retention-policy";

/** Registo global de cada execução (auditoria sem organização). */
export const RETENTION_RUN_ENTITY = "DataRetentionRun";

export interface RetentionRunSummary {
  startedAt: string;
  finishedAt: string;
  campaignsChecked: number;
  campaignsAnonymized: number;
  participationsAnonymized: number;
  participantsDeleted: number;
  failedCampaigns: number;
  /** Parou por tempo: o resto fica para a execução seguinte. */
  timedOut: boolean;
}

function describeForAudit(retention: EffectiveRetention) {
  if (retention.kind === "days") return { kind: "days", days: retention.days, source: retention.source };
  if (retention.kind === "until") return { kind: "until", until: retention.until.toISOString() };
  return { kind: "none" };
}

/**
 * Anonimiza as participações que passaram o prazo de conservação (§24).
 * Corre uma vez por dia (api/cron/retention) e é idempotente: uma
 * participação anonimizada não volta a ser lida, e duas execuções ao mesmo
 * tempo não se atropelam (cada lote bloqueia as suas linhas e salta as que
 * outra já tem).
 *
 * Cada campanha com participações anonimizadas fica na auditoria da sua
 * organização, só com contagens; a execução fica num registo global, que o
 * backoffice usa para avisar quando a tarefa deixou de correr.
 */
export async function runDataRetention(
  options: { now?: Date; timeBudgetMs?: number; batchSize?: number } = {},
): Promise<RetentionRunSummary> {
  const now = options.now ?? new Date();
  const startedAt = new Date();
  const deadline = Date.now() + (options.timeBudgetMs ?? 240_000);

  const campaigns = await prisma.campaign.findMany({
    where: {
      OR: [
        { dataRetentionDays: { not: null } },
        { dataRetentionUntil: { not: null } },
        { organization: { dataRetentionDays: { not: null } } },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      dataRetentionDays: true,
      dataRetentionUntil: true,
      organization: { select: { dataRetentionDays: true } },
    },
    orderBy: { id: "asc" },
  });

  const summary = {
    campaignsChecked: 0,
    campaignsAnonymized: 0,
    participationsAnonymized: 0,
    participantsDeleted: 0,
    failedCampaigns: 0,
    timedOut: false,
  };

  for (const campaign of campaigns) {
    if (Date.now() >= deadline) {
      summary.timedOut = true;
      break;
    }
    const retention = effectiveRetention({ campaign, organizationDays: campaign.organization.dataRetentionDays });
    const cutoff = retentionCutoff(retention, now);
    if (!cutoff) continue;
    summary.campaignsChecked += 1;

    try {
      const counts = await anonymizeCampaignBefore(campaign, cutoff, { now, deadline, batchSize: options.batchSize });
      summary.participationsAnonymized += counts.participationsAnonymized;
      summary.participantsDeleted += counts.participantsDeleted;
      if (counts.participationsAnonymized > 0) {
        summary.campaignsAnonymized += 1;
        await logAudit({
          organizationId: campaign.organizationId,
          action: "PRIVACY_OPERATION",
          entityType: "Campaign",
          entityId: campaign.id,
          result: "SUCCESS",
          metadata: {
            operation: "retention",
            participationsAnonymized: counts.participationsAnonymized,
            participantsDeleted: counts.participantsDeleted,
            retention: describeForAudit(retention),
          },
        });
      }
      if (counts.timedOut) {
        summary.timedOut = true;
        break;
      }
    } catch (error) {
      // Uma campanha que falha não trava as outras. Só o nome do erro: a
      // mensagem de uma query pode trazer valores.
      summary.failedCampaigns += 1;
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`[retention] falha a anonimizar a campanha ${campaign.id} (${name})`);
      await logAudit({
        organizationId: campaign.organizationId,
        action: "PRIVACY_OPERATION",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "FAILURE",
        metadata: { operation: "retention", reason: "error", error: name },
      }).catch(() => undefined);
    }
  }

  const result: RetentionRunSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    ...summary,
  };
  await logAudit({
    action: "PRIVACY_OPERATION",
    entityType: RETENTION_RUN_ENTITY,
    result: summary.failedCampaigns > 0 ? "FAILURE" : "SUCCESS",
    metadata: { operation: "retention_run", ...result },
  });
  return result;
}

/** A última execução da tarefa diária (null: nunca correu). */
export async function lastRetentionRun(): Promise<{ at: Date; result: string } | null> {
  const run = await prisma.auditLog.findFirst({
    where: { organizationId: null, entityType: RETENTION_RUN_ENTITY },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, result: true },
  });
  return run ? { at: run.createdAt, result: run.result } : null;
}
