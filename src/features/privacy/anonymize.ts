import { Prisma } from "@/generated/prisma/client";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import { retryOnDeadlock } from "@/lib/db/transaction-retry";
import { subjectParticipantCondition, type SubjectIdentifier } from "@/features/leads/queries";

/**
 * Anonimização de participações (§21, §24): o que se retira e o que fica.
 *
 * Saem os dados pessoais e tudo o que liga a participação a uma pessoa ou a
 * um dispositivo:
 * - nome, e-mail, telefone e as respostas ao formulário (ficam `{}`: a
 *   participação continua a contar como lead nas estatísticas);
 * - IP, sessão e a ligação ao Participant (o cookie do browser);
 * - `utm_content` e `utm_term`, que as newsletters usam para identificar o
 *   destinatário, e o caminho e a query da origem (o URL de onde veio).
 *
 * Ficam o resultado, o prémio e o código (o stock tem de bater certo), os
 * consentimentos (texto, versão e estado, já sem ninguém a quem se liguem), a
 * origem, o dispositivo e o browser: o que alimenta as estatísticas.
 *
 * O Participant que fica sem participações é apagado. O que continua (o
 * mesmo browser jogou noutras participações) perde os dados pessoais antigos
 * que ainda tivesse de antes de a identidade passar para a participação: o
 * nome, o e-mail e o telefone de quem está a ser anonimizado podiam estar lá.
 *
 * Consequência: as participações anonimizadas deixam de contar para os
 * limites de participação por e-mail, telefone, IP, sessão ou browser.
 */

export interface AnonymizationCounts {
  participationsAnonymized: number;
  participantsDeleted: number;
}

const BATCH_SIZE = 500;
// Um lote de 500 com as cascatas cabe folgadamente; o valor por omissão do
// Prisma (5 s) não.
const TRANSACTION_OPTIONS = { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 60_000 } as const;

interface LockedRow {
  id: string;
  participantId: string | null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** Anonimiza as linhas já bloqueadas (FOR UPDATE) pela transação `tx`. */
async function anonymizeLocked(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rows: readonly LockedRow[],
  now: Date,
): Promise<AnonymizationCounts> {
  if (rows.length === 0) return { participationsAnonymized: 0, participantsDeleted: 0 };

  const participationsAnonymized = await tx.$executeRaw`
    UPDATE "Participation" SET
      "email" = NULL,
      "phone" = NULL,
      "firstName" = NULL,
      "lastName" = NULL,
      "leadFormResponse" = CASE
        WHEN "leadFormResponse" IS NULL OR "leadFormResponse" = 'null'::jsonb THEN "leadFormResponse"
        ELSE '{}'::jsonb
      END,
      "ipAddress" = NULL,
      "sessionId" = NULL,
      "participantId" = NULL,
      "utmContent" = NULL,
      "utmTerm" = NULL,
      "source" = CASE
        WHEN "source" ~* '^https?://' THEN substring("source" from '^https?://([^/?#]+)')
        ELSE "source"
      END,
      "anonymizedAt" = ${now}
    WHERE "id" IN (${Prisma.join(rows.map((row) => row.id))}) AND "anonymizedAt" IS NULL`;

  // Como na eliminação de uma campanha: os candidatos ficam bloqueados antes
  // do DELETE. Uma participação a começar agora com o mesmo browser tem o
  // registo por confirmar, e o DELETE (uma instrução nova, depois da espera)
  // já a vê e deixa o participante.
  const candidates = [...new Set(rows.map((row) => row.participantId).filter((id): id is string => id !== null))];
  let participantsDeleted = 0;
  if (candidates.length > 0) {
    await tx.$queryRaw`
      SELECT "id" FROM "Participant"
      WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join(candidates)})
      ORDER BY "id"
      FOR UPDATE`;
    participantsDeleted = await tx.$executeRaw`
      DELETE FROM "Participant" p
      WHERE p."organizationId" = ${organizationId}
        AND p."id" IN (${Prisma.join(candidates)})
        AND NOT EXISTS (SELECT 1 FROM "Participation" x WHERE x."participantId" = p."id")`;
    // Os que ficam (jogaram noutras participações) só guardam o cookie.
    await tx.$executeRaw`
      UPDATE "Participant"
      SET "email" = NULL, "phone" = NULL, "firstName" = NULL, "lastName" = NULL, "anonymizedAt" = ${now}
      WHERE "organizationId" = ${organizationId}
        AND "id" IN (${Prisma.join(candidates)})
        AND ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)`;
  }

  return { participationsAnonymized, participantsDeleted };
}

function add(total: AnonymizationCounts, counts: AnonymizationCounts): void {
  total.participationsAnonymized += counts.participationsAnonymized;
  total.participantsDeleted += counts.participantsDeleted;
}

/**
 * Anonimiza as participações pedidas, só as da organização. Uma que esteja
 * a ser gravada neste momento (um jogo a decorrer) fica de fora — SKIP LOCKED
 * em vez de esperar — e é contada em `skipped`.
 */
export async function anonymizeParticipationsByIds(
  organizationId: string,
  participationIds: readonly string[],
  now: Date = new Date(),
  /** Vai sendo somado a cada lote confirmado (ver anonymizeCampaignBefore). */
  progress?: AnonymizationCounts,
): Promise<AnonymizationCounts & { skipped: number }> {
  const total: AnonymizationCounts = { participationsAnonymized: 0, participantsDeleted: 0 };
  let eligible = 0;
  for (const ids of chunk([...new Set(participationIds)], BATCH_SIZE)) {
    const { counts, found } = await retryOnDeadlock(() => prisma.$transaction(async (tx) => {
      // As campanhas primeiro, como a eliminação de uma campanha (que as
      // bloqueia FOR UPDATE antes das participações e dos participantes):
      // pela ordem inversa, as duas bloqueavam-se uma à outra (deadlock).
      await tx.$queryRaw`
        SELECT c."id" FROM "Campaign" c
        WHERE c."organizationId" = ${organizationId}
          AND c."id" IN (SELECT p."campaignId" FROM "Participation" p WHERE p."id" IN (${Prisma.join(ids)}))
        ORDER BY c."id"
        FOR KEY SHARE`;
      // Das pedidas, as da organização que ainda não foram anonimizadas.
      const pending = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM "Participation" p JOIN "Campaign" c ON c."id" = p."campaignId"
        WHERE c."organizationId" = ${organizationId} AND p."id" IN (${Prisma.join(ids)}) AND p."anonymizedAt" IS NULL`;
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT p."id", p."participantId"
        FROM "Participation" p JOIN "Campaign" c ON c."id" = p."campaignId"
        WHERE c."organizationId" = ${organizationId} AND p."id" IN (${Prisma.join(ids)}) AND p."anonymizedAt" IS NULL
        FOR UPDATE OF p SKIP LOCKED`;
      return { counts: await anonymizeLocked(tx, organizationId, rows, now), found: pending[0]?.count ?? 0 };
    }, TRANSACTION_OPTIONS));
    eligible += found;
    add(total, counts);
    if (progress) add(progress, counts);
  }
  return { ...total, skipped: Math.max(0, eligible - total.participationsAnonymized) };
}

/**
 * Anonimiza, por lotes, as participações de uma campanha criadas antes de
 * `cutoff` (prazo de conservação). Pára ao passar `deadline`: o resto fica
 * para a execução seguinte, que retoma onde esta ficou (as já anonimizadas
 * não voltam a ser lidas).
 */
export async function anonymizeCampaignBefore(
  campaign: { id: string; organizationId: string },
  cutoff: Date,
  options: {
    now: Date;
    deadline: number;
    batchSize?: number;
    /** Vai sendo somado a cada lote confirmado: com uma falha a meio, diz o que já saiu. */
    progress?: AnonymizationCounts;
  },
): Promise<AnonymizationCounts & { timedOut: boolean }> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const total: AnonymizationCounts = options.progress ?? { participationsAnonymized: 0, participantsDeleted: 0 };
  for (;;) {
    const { counts, read } = await retryOnDeadlock(() => prisma.$transaction(async (tx) => {
      // A campanha primeiro (ver anonymizeParticipationsByIds).
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaign.id} FOR KEY SHARE`;
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT "id", "participantId"
        FROM "Participation"
        WHERE "campaignId" = ${campaign.id} AND "anonymizedAt" IS NULL AND "createdAt" < ${cutoff}
        ORDER BY "createdAt", "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      return { counts: await anonymizeLocked(tx, campaign.organizationId, rows, options.now), read: rows.length };
    }, TRANSACTION_OPTIONS));
    add(total, counts);
    if (read < batchSize) return { ...total, timedOut: false };
    if (Date.now() >= options.deadline) return { ...total, timedOut: true };
  }
}

/**
 * Pedido de um titular: os dados pessoais antigos que ainda estejam num
 * Participant da organização com o mesmo e-mail ou telefone (de antes de a
 * identidade passar para a participação) também saem.
 */
export async function clearSubjectFromParticipants(
  organizationId: string,
  subject: SubjectIdentifier,
  now: Date = new Date(),
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Participant"
    SET "email" = NULL, "phone" = NULL, "firstName" = NULL, "lastName" = NULL, "anonymizedAt" = ${now}
    WHERE "organizationId" = ${organizationId} AND ${subjectParticipantCondition(subject)}`;
}
