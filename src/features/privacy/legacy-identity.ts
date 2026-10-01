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
 * no participante (ver leadsOnlyOnParticipant), a não ser que se aceite
 * perdê-la. Nunca escreve dados pessoais no terminal nem na auditoria: só
 * contagens (e ids de participação, para as rever).
 */

export const IDENTITY_MIGRATION = "20260928115347_participation_identity";
/** A que criou "Participation"."anonymizedAt", que as contagens também usam. */
export const RETENTION_MIGRATION = "20260930213627_data_retention";
const REQUIRED_MIGRATIONS = [IDENTITY_MIGRATION, RETENTION_MIGRATION];
const REQUIRED_COLUMNS = ["email", "phone", "firstName", "lastName", "anonymizedAt"];
const BATCH_SIZE = 1000;

export interface LegacyIdentityOrganization {
  organizationId: string;
  /** Participantes que ainda têm nome, e-mail ou telefone. */
  participants: number;
  leadsOnlyOnParticipant: number;
  ambiguousLeads: number;
  ambiguousParticipants: number;
  /** Até 20 das leadsOnlyOnParticipant, por ordem de id, para as rever. Só ids. */
  participationIds: string[];
}

export interface LegacyIdentityReport {
  /**
   * As migrações da identidade e da conservação (anonymizedAt) já correram.
   * Antes delas não se conta nada: as colunas ainda não existem.
   */
  migrationApplied: boolean;
  /** Participantes que ainda têm nome, e-mail ou telefone. */
  participantsWithData: number;
  /**
   * Leads reais (não de teste, não anonimizadas) a quem falta na
   * participação um dado que o participante tem e que o formulário da
   * campanha pede (e-mail, telefone, nome ou apelido), e que são a única
   * lead desse participante: as que a migração teria completado a partir do
   * participante (o backfill 2), e que perdiam o dado com a limpeza. Depois
   * da migração, são as gravadas pelo código antigo na janela do deploy;
   * prisma/maintenance/backfill_participation_identity.sql completa-as a
   * partir das respostas. Fazem recusar.
   */
  leadsOnlyOnParticipant: number;
  /**
   * O mesmo, em participantes com mais do que uma lead (um quiosque, um
   * browser partilhado, também com participações de teste): a migração
   * deixou-as em branco de propósito, porque os dados do participante são
   * os da última submissão e podiam ser de outra pessoa. Não fazem recusar.
   */
  ambiguousLeads: number;
  ambiguousParticipants: number;
  byOrganization: LegacyIdentityOrganization[];
}

/** Só estas organizações (os testes, ou uma de cada vez); sem nada, todas. */
export interface LegacyIdentityScope {
  organizationIds?: readonly string[];
}

function inScope(column: Prisma.Sql, scope: LegacyIdentityScope): Prisma.Sql {
  return scope.organizationIds ? Prisma.sql`AND ${column} = ANY(${[...scope.organizationIds]}::text[])` : Prisma.empty;
}

/**
 * As duas migrações correram e as colunas existem. Antes disso, qualquer
 * query às colunas novas de "Participation" falhava — e a recusa
 * "migration_pending" nunca chegava a ser dada. O registo das migrações não
 * chega sozinho (uma base sem ele, ou uma coluna criada à mão antes do
 * deploy, como o README sugere para "anonymizedAt"), e as colunas também
 * não: a da identidade pode existir sem a cópia ter acabado.
 */
async function requiredMigrationsApplied(): Promise<boolean> {
  const [schema] = await prisma.$queryRaw<Array<{ columns: number; migrationsTable: boolean }>>`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'Participation'
          AND column_name = ANY(${REQUIRED_COLUMNS}::text[])) AS columns,
      to_regclass('_prisma_migrations') IS NOT NULL AS "migrationsTable"`;
  if (!schema || schema.columns < REQUIRED_COLUMNS.length || !schema.migrationsTable) return false;
  const [migrations] = await prisma.$queryRaw<Array<{ applied: number }>>`
    SELECT COUNT(DISTINCT "migration_name")::int AS applied
    FROM "_prisma_migrations"
    WHERE "migration_name" = ANY(${REQUIRED_MIGRATIONS}::text[])
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  return (migrations?.applied ?? 0) === REQUIRED_MIGRATIONS.length;
}

export async function legacyIdentityReport(scope: LegacyIdentityScope = {}): Promise<LegacyIdentityReport> {
  if (!(await requiredMigrationsApplied())) {
    return {
      migrationApplied: false,
      participantsWithData: 0,
      leadsOnlyOnParticipant: 0,
      ambiguousLeads: 0,
      ambiguousParticipants: 0,
      byOrganization: [],
    };
  }

  const participants = await prisma.$queryRaw<Array<{ organizationId: string; participants: number }>>`
    SELECT "organizationId", COUNT(*)::int AS participants
    FROM "Participant"
    WHERE ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)
      ${inScope(Prisma.sql`"organizationId"`, scope)}
    GROUP BY "organizationId"
    ORDER BY "organizationId"`;
  // As regras do backfill 2 da migração: só os tipos que o participante tem
  // (um valor só com espaços não conta) e que o formulário da campanha pede;
  // um participante com mais do que uma participação com formulário (também
  // de teste) é ambíguo.
  const atRisk = await prisma.$queryRaw<Array<Omit<LegacyIdentityOrganization, "participants">>>`
    WITH "holders" AS (
      SELECT
        "id",
        "organizationId",
        NULLIF(BTRIM("email"), '') IS NOT NULL AS "email",
        NULLIF(BTRIM("phone"), '') IS NOT NULL AS "phone",
        NULLIF(BTRIM("firstName"), '') IS NOT NULL AS "firstName",
        NULLIF(BTRIM("lastName"), '') IS NOT NULL AS "lastName"
      FROM "Participant"
      WHERE ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)
        ${inScope(Prisma.sql`"organizationId"`, scope)}
    ),
    "leadCounts" AS (
      SELECT p."participantId", COUNT(*) AS "leads"
      FROM "Participation" p
      JOIN "holders" h ON h."id" = p."participantId"
      WHERE p."leadFormResponse" IS NOT NULL AND p."leadFormResponse" <> 'null'::jsonb
      GROUP BY p."participantId"
    ),
    "formTypes" AS (
      SELECT
        lf."campaignId",
        BOOL_OR(f."type" = 'EMAIL') AS "email",
        BOOL_OR(f."type" = 'PHONE') AS "phone",
        BOOL_OR(f."type" IN ('FIRST_NAME', 'FULL_NAME')) AS "firstName",
        BOOL_OR(f."type" = 'LAST_NAME') AS "lastName"
      FROM "LeadForm" lf
      JOIN "LeadFormField" f ON f."leadFormId" = lf."id"
      GROUP BY lf."campaignId"
    ),
    "missing" AS (
      SELECT h."organizationId", p."id", p."participantId", lc."leads" > 1 AS "ambiguous"
      FROM "Participation" p
      JOIN "holders" h ON h."id" = p."participantId"
      JOIN "leadCounts" lc ON lc."participantId" = p."participantId"
      JOIN "formTypes" ft ON ft."campaignId" = p."campaignId"
      WHERE p."isTest" = false
        AND p."anonymizedAt" IS NULL
        AND p."leadFormResponse" IS NOT NULL AND p."leadFormResponse" <> 'null'::jsonb
        AND (
          (ft."email" AND h."email" AND p."email" IS NULL)
          OR (ft."phone" AND h."phone" AND p."phone" IS NULL)
          OR (ft."firstName" AND h."firstName" AND p."firstName" IS NULL)
          OR (ft."lastName" AND h."lastName" AND p."lastName" IS NULL)
        )
    )
    SELECT
      "organizationId",
      COUNT(*) FILTER (WHERE NOT "ambiguous")::int AS "leadsOnlyOnParticipant",
      COUNT(*) FILTER (WHERE "ambiguous")::int AS "ambiguousLeads",
      COUNT(DISTINCT "participantId") FILTER (WHERE "ambiguous")::int AS "ambiguousParticipants",
      COALESCE((ARRAY_AGG("id" ORDER BY "id") FILTER (WHERE NOT "ambiguous"))[1:20], '{}'::text[]) AS "participationIds"
    FROM "missing"
    GROUP BY "organizationId"`;

  const risk = new Map(atRisk.map((row) => [row.organizationId, row]));
  const byOrganization = participants.map(({ organizationId, participants: count }) => ({
    organizationId,
    participants: count,
    leadsOnlyOnParticipant: risk.get(organizationId)?.leadsOnlyOnParticipant ?? 0,
    ambiguousLeads: risk.get(organizationId)?.ambiguousLeads ?? 0,
    ambiguousParticipants: risk.get(organizationId)?.ambiguousParticipants ?? 0,
    participationIds: risk.get(organizationId)?.participationIds ?? [],
  }));
  const sum = (key: "participants" | "leadsOnlyOnParticipant" | "ambiguousLeads" | "ambiguousParticipants") =>
    byOrganization.reduce((total, row) => total + row[key], 0);
  return {
    migrationApplied: true,
    participantsWithData: sum("participants"),
    leadsOnlyOnParticipant: sum("leadsOnlyOnParticipant"),
    ambiguousLeads: sum("ambiguousLeads"),
    ambiguousParticipants: sum("ambiguousParticipants"),
    byOrganization,
  };
}

export type LegacyIdentityCleanup =
  | { status: "cleared"; participantsCleared: number; byOrganization: Array<{ organizationId: string; participants: number }> }
  | { status: "refused"; reason: "migration_pending" | "leads_only_on_participant"; report: LegacyIdentityReport };

/**
 * Tira o nome, o e-mail e o telefone de todos os participantes, por lotes
 * (cada um numa transação, com as linhas bloqueadas por ordem de id, como a
 * anonimização, para as duas não se bloquearem uma à outra).
 *
 * Na auditoria de cada organização, como em audited() (actions.ts): uma
 * linha antes do primeiro lote, com as contagens da simulação, e outra no
 * fim, com quantos participantes saíram — também quando falha a meio
 * ("interrupted"): cada lote confirma à parte, e o que já saiu não volta.
 * Só se tocam as organizações que já têm a primeira linha; uma que só
 * ganhe dados depois da simulação (o código antigo ainda a servir) fica
 * para a execução seguinte.
 */
export async function clearLegacyParticipantIdentity(
  options: LegacyIdentityScope & {
    acceptLoss?: boolean;
    now?: Date;
    batchSize?: number;
    /** Participantes limpos por organização, somados a cada lote confirmado: numa falha, diz o que já saiu. */
    progress?: Map<string, number>;
  } = {},
): Promise<LegacyIdentityCleanup> {
  const report = await legacyIdentityReport(options);
  if (!report.migrationApplied) return { status: "refused", reason: "migration_pending", report };
  if (report.leadsOnlyOnParticipant > 0 && !options.acceptLoss) {
    return { status: "refused", reason: "leads_only_on_participant", report };
  }

  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const cleared = options.progress ?? new Map<string, number>();
  const started: LegacyIdentityOrganization[] = [];
  const base = (organization: LegacyIdentityOrganization) => ({
    organizationId: organization.organizationId,
    action: "PRIVACY_OPERATION" as const,
    entityType: "Participant",
  });
  // Por organização: só perde identidade quem tinha leads nesse estado.
  const acceptedLoss = (organization: LegacyIdentityOrganization) => organization.leadsOnlyOnParticipant > 0;

  let outcome: "completed" | "interrupted" = "interrupted";
  try {
    for (const organization of report.byOrganization) {
      await logAudit({
        ...base(organization),
        result: "SUCCESS",
        metadata: {
          operation: "legacy_identity_cleanup",
          stage: "started",
          participantsWithData: organization.participants,
          leadsOnlyOnParticipant: organization.leadsOnlyOnParticipant,
          ambiguousLeads: organization.ambiguousLeads,
          acceptedLoss: acceptedLoss(organization),
        },
      });
      started.push(organization);
      cleared.set(organization.organizationId, cleared.get(organization.organizationId) ?? 0);
    }

    const organizationIds = started.map((organization) => organization.organizationId);
    let lastId = "";
    while (organizationIds.length > 0) {
      const batch = await retryOnDeadlock(() =>
        prisma.$transaction(
          async (tx) =>
            tx.$queryRaw<Array<{ id: string; organizationId: string }>>`
              WITH locked AS (
                SELECT "id" FROM "Participant"
                WHERE "id" > ${lastId}
                  AND ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)
                  AND "organizationId" = ANY(${organizationIds}::text[])
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
      // Confirmado: conta já, antes do lote seguinte.
      for (const row of batch) cleared.set(row.organizationId, (cleared.get(row.organizationId) ?? 0) + 1);
      if (batch.length < batchSize) break;
      lastId = batch.reduce((max, row) => (row.id > max ? row.id : max), lastId);
    }
    outcome = "completed";
  } finally {
    for (const organization of started) {
      await logAudit({
        ...base(organization),
        result: outcome === "completed" ? "SUCCESS" : "FAILURE",
        metadata: {
          operation: "legacy_identity_cleanup",
          stage: outcome,
          participantsCleared: cleared.get(organization.organizationId) ?? 0,
          acceptedLoss: acceptedLoss(organization),
        },
      }).catch(() => undefined);
    }
  }

  const byOrganization = started.map(({ organizationId }) => ({ organizationId, participants: cleared.get(organizationId) ?? 0 }));
  return {
    status: "cleared",
    participantsCleared: byOrganization.reduce((sum, row) => sum + row.participants, 0),
    byOrganization,
  };
}
