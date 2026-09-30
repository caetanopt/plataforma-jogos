import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

/**
 * Anonimização de participações (§21, §24): o que se retira e o que fica.
 *
 * Saem os dados pessoais e tudo o que liga a participação a uma pessoa ou a
 * um dispositivo:
 * - nome, e-mail, telefone e as respostas ao formulário (ficam `{}`: a
 *   participação continua a contar como lead nas estatísticas);
 * - IP, sessão e a ligação ao Participant (o cookie do browser);
 * - `utm_content` e `utm_term`, que as newsletters usam para identificar o
 *   destinatário.
 *
 * Ficam o resultado, o prémio e o código (o stock tem de bater certo), os
 * consentimentos (texto, versão e estado, já sem ninguém a quem se liguem), a
 * origem, o dispositivo e o browser: o que alimenta as estatísticas.
 *
 * O Participant que fica sem participações é apagado, com os dados antigos
 * que ainda tivesse (antes de a identidade passar para a participação).
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
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

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
      FOR UPDATE`;
    participantsDeleted = await tx.$executeRaw`
      DELETE FROM "Participant" p
      WHERE p."organizationId" = ${organizationId}
        AND p."id" IN (${Prisma.join(candidates)})
        AND NOT EXISTS (SELECT 1 FROM "Participation" x WHERE x."participantId" = p."id")`;
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
): Promise<AnonymizationCounts & { skipped: number }> {
  const total: AnonymizationCounts = { participationsAnonymized: 0, participantsDeleted: 0 };
  let eligible = 0;
  for (const ids of chunk([...new Set(participationIds)], BATCH_SIZE)) {
    const { counts, found } = await prisma.$transaction(async (tx) => {
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
    }, TRANSACTION_OPTIONS);
    eligible += found;
    add(total, counts);
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
  options: { now: Date; deadline: number; batchSize?: number },
): Promise<AnonymizationCounts & { timedOut: boolean }> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const total: AnonymizationCounts = { participationsAnonymized: 0, participantsDeleted: 0 };
  for (;;) {
    const { counts, read } = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedRow[]>`
        SELECT "id", "participantId"
        FROM "Participation"
        WHERE "campaignId" = ${campaign.id} AND "anonymizedAt" IS NULL AND "createdAt" < ${cutoff}
        ORDER BY "createdAt", "id"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      return { counts: await anonymizeLocked(tx, campaign.organizationId, rows, options.now), read: rows.length };
    }, TRANSACTION_OPTIONS);
    add(total, counts);
    if (read < batchSize) return { ...total, timedOut: false };
    if (Date.now() >= options.deadline) return { ...total, timedOut: true };
  }
}
