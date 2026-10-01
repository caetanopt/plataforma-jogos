import { Prisma } from "@/generated/prisma/client";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import { retryOnDeadlock } from "@/lib/db/transaction-retry";
import { logAudit } from "@/server/audit/log";

/**
 * Limpeza dos dados pessoais antigos dos participantes (§24, minimização).
 *
 * Até à migração 20260928115347_participation_identity, o nome, o e-mail e
 * o telefone viviam no Participant — partilhado por quem usa o mesmo
 * browser — e cada submissão reescrevia-os. A identidade passou para cada
 * participação (a migração copiou-a), e o código deixou de os escrever e de
 * os ler: ficaram dados pessoais sem uso, que só a anonimização de um
 * titular ou de uma campanha tirava aos participantes que tocava.
 *
 * Irreversível. Por isso: só depois de a migração ter corrido; por omissão
 * só conta (simulação); e recusa se alguma lead ainda só tiver a identidade
 * no participante (a cópia não a conseguiu mapear), a não ser que se aceite
 * perdê-la. Nunca escreve dados pessoais no terminal nem na auditoria: só
 * contagens.
 */

export const IDENTITY_MIGRATION = "20260928115347_participation_identity";
const BATCH_SIZE = 1000;

export interface LegacyIdentityReport {
  /** A migração que copiou a identidade para as participações já correu. */
  migrationApplied: boolean;
  /** Participantes que ainda têm nome, e-mail ou telefone. */
  participantsWithData: number;
  /**
   * Leads (formulário submetido, não anonimizadas) sem identidade na
   * participação cujo participante a tem: perdiam-na com a limpeza.
   */
  leadsOnlyOnParticipant: number;
  byOrganization: Array<{ organizationId: string; participants: number }>;
}

/** Só estas organizações (os testes, ou uma de cada vez); sem nada, todas. */
export interface LegacyIdentityScope {
  organizationIds?: readonly string[];
}

function inScope(column: Prisma.Sql, scope: LegacyIdentityScope): Prisma.Sql {
  return scope.organizationIds ? Prisma.sql`AND ${column} = ANY(${[...scope.organizationIds]}::text[])` : Prisma.empty;
}

export async function legacyIdentityReport(scope: LegacyIdentityScope = {}): Promise<LegacyIdentityReport> {
  const [migration] = await prisma.$queryRaw<Array<{ applied: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "_prisma_migrations"
      WHERE "migration_name" = ${IDENTITY_MIGRATION} AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
    ) AS applied`;
  const byOrganization = await prisma.$queryRaw<Array<{ organizationId: string; participants: number }>>`
    SELECT "organizationId", COUNT(*)::int AS participants
    FROM "Participant"
    WHERE ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)
      ${inScope(Prisma.sql`"organizationId"`, scope)}
    GROUP BY "organizationId"
    ORDER BY "organizationId"`;
  const [unmatched] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "Participation" p JOIN "Participant" pt ON pt."id" = p."participantId"
    WHERE p."anonymizedAt" IS NULL
      AND p."leadFormResponse" IS NOT NULL AND p."leadFormResponse" <> 'null'::jsonb
      AND p."email" IS NULL AND p."phone" IS NULL AND p."firstName" IS NULL AND p."lastName" IS NULL
      AND (pt."email" IS NOT NULL OR pt."phone" IS NOT NULL OR pt."firstName" IS NOT NULL OR pt."lastName" IS NOT NULL)
      ${inScope(Prisma.sql`pt."organizationId"`, scope)}`;
  return {
    migrationApplied: migration?.applied ?? false,
    participantsWithData: byOrganization.reduce((sum, row) => sum + row.participants, 0),
    leadsOnlyOnParticipant: unmatched?.count ?? 0,
    byOrganization,
  };
}

export type LegacyIdentityCleanup =
  | { status: "cleared"; participantsCleared: number; byOrganization: Array<{ organizationId: string; participants: number }> }
  | { status: "refused"; reason: "migration_pending" | "leads_only_on_participant"; report: LegacyIdentityReport };

/**
 * Tira o nome, o e-mail e o telefone de todos os participantes, por lotes
 * (cada um numa transação, com as linhas bloqueadas por ordem de id, como a
 * anonimização, para as duas não se bloquearem uma à outra). Fica uma linha
 * na auditoria de cada organização, com quantos saíram.
 */
export async function clearLegacyParticipantIdentity(
  options: LegacyIdentityScope & { acceptLoss?: boolean; now?: Date; batchSize?: number } = {},
): Promise<LegacyIdentityCleanup> {
  const report = await legacyIdentityReport(options);
  if (!report.migrationApplied) return { status: "refused", reason: "migration_pending", report };
  if (report.leadsOnlyOnParticipant > 0 && !options.acceptLoss) {
    return { status: "refused", reason: "leads_only_on_participant", report };
  }

  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const cleared = new Map<string, number>();
  let lastId = "";
  for (;;) {
    const batch = await retryOnDeadlock(() =>
      prisma.$transaction(
        async (tx) =>
          tx.$queryRaw<Array<{ id: string; organizationId: string }>>`
            WITH locked AS (
              SELECT "id" FROM "Participant"
              WHERE "id" > ${lastId}
                AND ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)
                ${inScope(Prisma.sql`"organizationId"`, options)}
              ORDER BY "id"
              LIMIT ${batchSize}
              FOR UPDATE
            )
            UPDATE "Participant" pt
            SET "email" = NULL, "phone" = NULL, "firstName" = NULL, "lastName" = NULL,
                "anonymizedAt" = COALESCE(pt."anonymizedAt", ${now})
            FROM locked WHERE pt."id" = locked."id"
            RETURNING pt."id", pt."organizationId"`,
        { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 60_000 },
      ),
    );
    for (const row of batch) cleared.set(row.organizationId, (cleared.get(row.organizationId) ?? 0) + 1);
    if (batch.length < batchSize) break;
    lastId = batch.reduce((max, row) => (row.id > max ? row.id : max), lastId);
  }

  const byOrganization = [...cleared.entries()].map(([organizationId, participants]) => ({ organizationId, participants }));
  for (const { organizationId, participants } of byOrganization) {
    await logAudit({
      organizationId,
      action: "PRIVACY_OPERATION",
      entityType: "Participant",
      result: "SUCCESS",
      metadata: {
        operation: "legacy_identity_cleanup",
        participantsCleared: participants,
        acceptedLoss: report.leadsOnlyOnParticipant > 0,
      },
    });
  }
  return {
    status: "cleared",
    participantsCleared: byOrganization.reduce((sum, row) => sum + row.participants, 0),
    byOrganization,
  };
}
