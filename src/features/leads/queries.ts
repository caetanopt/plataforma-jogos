import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { DateRange } from "@/lib/dates/range";

export type MarketingConsentFilter = "granted" | "not_granted";

export interface LeadsFilters {
  campaignId?: string;
  search?: string;
  excludeTest?: boolean;
  /** Com (ou sem) pelo menos um consentimento de marketing aceite (§21, §24). */
  marketingConsent?: MarketingConsentFilter;
  /** Sem as participações já anonimizadas (§24). */
  hideAnonymized?: boolean;
  page?: number;
  pageSize?: number;
}

export function parseMarketingConsentFilter(value: string | undefined): MarketingConsentFilter | undefined {
  return value === "granted" || value === "not_granted" ? value : undefined;
}

const MARKETING_GRANTED: Prisma.ParticipationWhereInput = {
  consentRecords: { some: { status: "GRANTED", consentDefinition: { isMarketing: true } } },
};

/**
 * Os consentimentos de cada participação, pela ordem do formulário. Sem
 * eles, a exportação para uma newsletter levava também quem recusou o
 * marketing (§21: consentimentos na lista e na exportação).
 */
export const leadConsentRecords = {
  select: {
    consentDefinitionId: true,
    status: true,
    text: true,
    version: true,
    grantedAt: true,
    consentDefinition: { select: { isMarketing: true, order: true } },
  },
  orderBy: [{ consentDefinition: { order: "asc" } }, { grantedAt: "asc" }],
} satisfies Prisma.Participation$consentRecordsArgs;

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
    ...(filters.marketingConsent === "granted" ? MARKETING_GRANTED : {}),
    ...(filters.marketingConsent === "not_granted" ? { NOT: MARKETING_GRANTED } : {}),
    ...(filters.hideAnonymized ? { anonymizedAt: null } : {}),
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

/** Quantas das participações que os filtros apanham ainda têm os dados. */
export function countLeadsToAnonymize(
  organizationId: string,
  range: DateRange,
  filters: LeadsFilters,
  createdUpTo?: Date,
) {
  return prisma.participation.count({ where: toAnonymizeWhere(organizationId, range, filters, createdUpTo) });
}

export type SubjectIdentifier = { kind: "email"; email: string } | { kind: "phone"; phone: string; digits: string };

/**
 * As participações de um titular (pedido de acesso ou de eliminação, §24), por igualdade
 * exata do e-mail ou do telefone — nunca por "contém", que apanhava a joana
 * quando o pedido era da ana. Procura também nas respostas ao formulário:
 * um segundo campo de e-mail, ou dados antigos que não passaram para as
 * colunas de identidade. Em todas as campanhas e períodos, reais e de teste.
 */
export function findSubjectParticipations(organizationId: string, subject: SubjectIdentifier) {
  const matches =
    subject.kind === "email"
      ? Prisma.sql`(
          p."email" = ${subject.email}
          OR EXISTS (
            SELECT 1 FROM jsonb_each_text(
              CASE WHEN jsonb_typeof(p."leadFormResponse") = 'object' THEN p."leadFormResponse" ELSE '{}'::jsonb END
            ) AS kv
            WHERE lower(btrim(kv.value)) = ${subject.email}
          )
        )`
      : Prisma.sql`(
          p."phone" = ${subject.phone}
          OR EXISTS (
            SELECT 1 FROM jsonb_each_text(
              CASE WHEN jsonb_typeof(p."leadFormResponse") = 'object' THEN p."leadFormResponse" ELSE '{}'::jsonb END
            ) AS kv
            WHERE regexp_replace(kv.value, '[^0-9]', '', 'g') = ${subject.digits}
          )
        )`;
  return prisma.$queryRaw<Array<{ id: string; campaignId: string; createdAt: Date }>>`
    SELECT p."id", p."campaignId", p."createdAt"
    FROM "Participation" p
    JOIN "Campaign" c ON c."id" = p."campaignId"
    WHERE c."organizationId" = ${organizationId} AND p."anonymizedAt" IS NULL AND ${matches}`;
}

/**
 * Os Participant da organização com o e-mail ou o telefone do titular nos
 * dados antigos (de antes de a identidade passar para a participação). A
 * mesma condição na exportação e na eliminação.
 */
export function subjectParticipantCondition(subject: SubjectIdentifier): Prisma.Sql {
  return subject.kind === "email"
    ? Prisma.sql`lower(btrim("email")) = ${subject.email}`
    : Prisma.sql`regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') = ${subject.digits}`;
}

export function findSubjectLegacyParticipants(organizationId: string, subject: SubjectIdentifier) {
  return prisma.$queryRaw<
    Array<{ email: string | null; phone: string | null; firstName: string | null; lastName: string | null; createdAt: Date }>
  >`
    SELECT "email", "phone", "firstName", "lastName", "createdAt"
    FROM "Participant"
    WHERE "organizationId" = ${organizationId} AND ${subjectParticipantCondition(subject)}
    ORDER BY "createdAt", "id"`;
}

export async function listLeads(organizationId: string, range: DateRange, filters: LeadsFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = buildWhere(organizationId, range, filters);

  const [items, total] = await Promise.all([
    prisma.participation.findMany({
      where,
      // Com o id a desempatar, a mesma participação não aparece em duas páginas.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        campaign: { select: { id: true, internalName: true, type: true } },
        prizeAward: { include: { prize: true, prizeCode: true } },
        consentRecords: leadConsentRecords,
      },
    }),
    prisma.participation.count({ where }),
  ]);

  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Participações lidas por lote na exportação. */
export const EXPORT_BATCH_SIZE = 500;

const exportInclude = {
  campaign: { select: { internalName: true, type: true } },
  prizeAward: { include: { prize: true, prizeCode: true } },
  consentRecords: leadConsentRecords,
} satisfies Prisma.ParticipationInclude;

/**
 * As participações da exportação, por lotes, das mais recentes para as mais
 * antigas. Antes lia-se tudo de uma vez (e o CSV era montado em memória com
 * mais duas cópias): uma campanha grande esgotava a memória da função.
 *
 * Cada lote continua a partir dos valores (data, id) da última linha do
 * anterior, não do id como cursor do Prisma: esse relia a linha do cursor e,
 * se ela fosse apagada entre lotes (uma campanha eliminada durante a
 * exportação de todas), o lote seguinte vinha vazio e a exportação acabava
 * a meio, dada como completa. O limite `lte` na data deixa o índice
 * (createdAt, id) começar no sítio certo em vez de reler o que já saiu.
 */
export async function* iterateLeadsForExport(
  organizationId: string,
  range: DateRange,
  filters: LeadsFilters,
  batchSize = EXPORT_BATCH_SIZE,
) {
  const where = buildWhere(organizationId, range, filters);
  let last: { createdAt: Date; id: string } | undefined;
  for (;;) {
    const batch: Array<Prisma.ParticipationGetPayload<{ include: typeof exportInclude }>> =
      await prisma.participation.findMany({
        where: last
          ? {
              AND: [
                where,
                { createdAt: { lte: last.createdAt } },
                { OR: [{ createdAt: { lt: last.createdAt } }, { id: { lt: last.id } }] },
              ],
            }
          : where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: batchSize,
        include: exportInclude,
      });
    if (batch.length > 0) yield batch;
    if (batch.length < batchSize) return;
    const tail = batch[batch.length - 1]!;
    last = { createdAt: tail.createdAt, id: tail.id };
  }
}

/**
 * Os ids das participações que os filtros apanham e ainda não foram
 * anonimizadas, por lotes (anonimizar "tudo o que os filtros mostram"). Por
 * id, de lote em lote: uma participação saltada (a ser gravada agora) não
 * volta a ser lida no mesmo pedido.
 */
function toAnonymizeWhere(
  organizationId: string,
  range: DateRange,
  filters: LeadsFilters,
  createdUpTo?: Date,
): Prisma.ParticipationWhereInput {
  return {
    AND: [
      buildWhere(organizationId, range, filters),
      { anonymizedAt: null },
      // As que existiam quando a página foi mostrada: uma lead que chegue
      // entretanto não entra numa confirmação feita antes dela.
      ...(createdUpTo ? [{ createdAt: { lte: createdUpTo } }] : []),
    ],
  };
}

export async function* iterateLeadIdsToAnonymize(
  organizationId: string,
  range: DateRange,
  filters: LeadsFilters,
  options: { createdUpTo?: Date; batchSize?: number } = {},
) {
  const batchSize = options.batchSize ?? EXPORT_BATCH_SIZE;
  const where = toAnonymizeWhere(organizationId, range, filters, options.createdUpTo);
  let lastId: string | undefined;
  for (;;) {
    const batch = await prisma.participation.findMany({
      where: lastId ? { AND: [where, { id: { gt: lastId } }] } : where,
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (batch.length > 0) yield batch.map((row) => row.id);
    if (batch.length < batchSize) return;
    lastId = batch[batch.length - 1]!.id;
  }
}

/**
 * Consentimentos do formulário de uma campanha, para as colunas por
 * consentimento da exportação de uma só campanha.
 */
export function listCampaignConsentDefinitions(organizationId: string, campaignId: string) {
  return prisma.consentDefinition.findMany({
    where: { leadForm: { campaign: { id: campaignId, organizationId } } },
    select: { id: true, text: true, version: true, isMarketing: true },
    orderBy: { order: "asc" },
  });
}
