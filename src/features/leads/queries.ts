import { prisma } from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { DateRange } from "@/lib/dates/range";
import type { PhoneMatchForms } from "@/features/play/identity";

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

/**
 * O e-mail ou o telefone de um pedido de um titular (parseSubjectIdentifier):
 * o e-mail normalizado; o telefone normalizado e as formas equivalentes
 * (phoneMatchForms: com e sem o +351).
 */
export type SubjectIdentifier =
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string; forms: PhoneMatchForms };

/**
 * Uma resposta mais comprida do que isto nunca é um e-mail ou um telefone:
 * nem chega a ser normalizada. Antes, o regexp corria sobre todas as
 * respostas da organização — também os textos longos — e a procura de um
 * telefone levava 13 a 16 s com 150 mil leads.
 */
const EMAIL_ANSWER_MAX_BYTES = 320;
const PHONE_ANSWER_MAX_BYTES = 40;
/** O que o trim() do JavaScript (normalizeEmail) também tira. */
const TRIMMED_CHARACTERS = " \t\r\n";

/**
 * Uma resposta ao formulário (ou um dado antigo do Participant), em texto, é
 * o identificador do titular? O e-mail sem maiúsculas nem espaços à volta;
 * o telefone pelos dígitos, com o "+" que viesse antes do primeiro dígito
 * (writtenPhoneForm), contra as formas escritas do número.
 *
 * As guardas vêm antes de qualquer normalização, num CASE (o Postgres não
 * garante a ordem de um AND): o comprimento em bytes (que não percorre o
 * texto) e, no telefone, o número de dígitos — só um valor com tantos
 * dígitos como uma das formas chega ao regexp.
 */
function answerIsSubject(subject: SubjectIdentifier, value: Prisma.Sql): Prisma.Sql {
  if (subject.kind === "email") {
    return Prisma.sql`(CASE
      WHEN octet_length(${value}) > ${EMAIL_ANSWER_MAX_BYTES} OR strpos(${value}, '@') = 0 THEN false
      ELSE lower(btrim(${value}, ${TRIMMED_CHARACTERS})) = ${subject.email}
    END)`;
  }
  const written = subject.forms.written;
  const digitCounts = [...new Set(written.map((form) => form.replace("+", "").length))];
  return Prisma.sql`(CASE
    WHEN octet_length(${value}) > ${PHONE_ANSWER_MAX_BYTES} THEN false
    WHEN length(${value}) - length(translate(${value}, '0123456789', '')) <> ALL (${digitCounts}::int[]) THEN false
    ELSE (CASE WHEN substring(${value} from '[0-9+]') = '+' THEN '+' ELSE '' END)
      || regexp_replace(${value}, '[^0-9]', '', 'g') = ANY (${written}::text[])
  END)`;
}

/** As colunas de identidade da participação `p` são as do titular. */
function identityIsSubject(subject: SubjectIdentifier): Prisma.Sql {
  return subject.kind === "email"
    ? Prisma.sql`COALESCE(p."email" = ${subject.email}, false)`
    : Prisma.sql`COALESCE(p."phone" = ANY (${subject.forms.normalized}::text[]), false)`;
}

/**
 * Os campos ocultos de cada campanha da organização (CTE "hidden"): o
 * servidor é que os preenche (um valor por omissão, por exemplo o e-mail de
 * um concessionário), não dizem nada sobre quem respondeu.
 */
function hiddenFieldKeys(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT lf."campaignId", array_agg(f."internalKey") AS "keys"
    FROM "LeadFormField" f
    JOIN "LeadForm" lf ON lf."id" = f."leadFormId"
    JOIN "Campaign" hc ON hc."id" = lf."campaignId"
    WHERE hc."organizationId" = ${organizationId} AND f."type" = 'HIDDEN'
    GROUP BY lf."campaignId"`;
}

/**
 * As respostas da participação `p` (com os campos ocultos da campanha em
 * `h`) que são o identificador do titular: uma linha por campo, com a chave
 * e o valor. Para usar num LATERAL.
 */
function mentionedAnswers(subject: SubjectIdentifier): Prisma.Sql {
  return Prisma.sql`
    SELECT kv."key", kv."value"
    FROM jsonb_each_text(
      CASE WHEN jsonb_typeof(p."leadFormResponse") = 'object' THEN p."leadFormResponse" ELSE '{}'::jsonb END
    ) AS kv
    WHERE (h."keys" IS NULL OR kv."key" <> ALL (h."keys")) AND ${answerIsSubject(subject, Prisma.sql`kv."value"`)}`;
}

export interface SubjectMatch {
  id: string;
  campaignId: string;
  createdAt: Date;
}

export interface SubjectMention extends SubjectMatch {
  /** As chaves das respostas com o identificador do titular. */
  keys: string[];
}

export interface SubjectMatches {
  /** As do titular: o e-mail ou o telefone nas colunas de identidade. */
  identity: SubjectMatch[];
  /**
   * As de outras pessoas que o mencionam numa resposta (o e-mail de um amigo,
   * um segundo telefone). Destas só sai o campo, nunca o resto da lead.
   */
  mentions: SubjectMention[];
}

/** Quantas menções (campos) há, ao todo. */
export function countMentions(mentions: readonly SubjectMention[]): number {
  return mentions.reduce((sum, mention) => sum + mention.keys.length, 0);
}

/**
 * As participações de um titular (pedido de acesso ou de eliminação, §24),
 * por igualdade exata do e-mail ou do telefone — nunca por "contém", que
 * apanhava a joana quando o pedido era da ana. Em todas as campanhas e
 * períodos, reais e de teste.
 *
 * Duas listas, porque uma resposta igual ao identificador não faz da
 * participação dele: um campo "e-mail de um amigo", um segundo telefone ou
 * um campo oculto com um valor fixo apanhavam a lead inteira de outra pessoa
 * — que a exportação entregava ao titular e a anonimização apagava. Agora:
 * - identidade: as colunas de identidade (o primeiro campo de e-mail ou de
 *   telefone do formulário, ver identity.ts) são as do titular;
 * - menções: outra participação com o identificador numa resposta, fora dos
 *   campos ocultos da campanha.
 */
export async function findSubjectParticipations(
  organizationId: string,
  subject: SubjectIdentifier,
): Promise<SubjectMatches> {
  const identity = identityIsSubject(subject);
  const rows = await prisma.$queryRaw<Array<SubjectMatch & { identity: boolean; keys: string[] | null }>>`
    WITH hidden AS (${hiddenFieldKeys(organizationId)})
    SELECT p."id", p."campaignId", p."createdAt", ${identity} AS "identity", m."keys"
    FROM "Participation" p
    JOIN "Campaign" c ON c."id" = p."campaignId"
    LEFT JOIN hidden h ON h."campaignId" = p."campaignId"
    CROSS JOIN LATERAL (
      SELECT array_agg(a."key" ORDER BY a."key") AS "keys" FROM (${mentionedAnswers(subject)}) a
    ) m
    WHERE c."organizationId" = ${organizationId} AND p."anonymizedAt" IS NULL
      AND (${identity} OR m."keys" IS NOT NULL)`;
  const matches: SubjectMatches = { identity: [], mentions: [] };
  for (const { identity: isIdentity, keys, ...match } of rows) {
    if (isIdentity) matches.identity.push(match);
    else if (keys && keys.length > 0) matches.mentions.push({ ...match, keys });
  }
  return matches;
}

/**
 * Os campos com o identificador do titular nas participações pedidas (as
 * menções de findSubjectParticipations), lidos de novo: uma participação
 * anonimizada entretanto, ou um campo já retirado, não sai. Só a chave e o
 * valor, nunca o resto da lead.
 */
export function findSubjectMentionAnswers(organizationId: string, subject: SubjectIdentifier, ids: readonly string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.$queryRaw<Array<{ id: string; campaignId: string; createdAt: Date; key: string; value: string }>>`
    WITH hidden AS (${hiddenFieldKeys(organizationId)})
    SELECT p."id", p."campaignId", p."createdAt", a."key", a."value"
    FROM "Participation" p
    JOIN "Campaign" c ON c."id" = p."campaignId"
    LEFT JOIN hidden h ON h."campaignId" = p."campaignId"
    CROSS JOIN LATERAL (${mentionedAnswers(subject)}) a
    WHERE p."id" IN (${Prisma.join(ids)}) AND c."organizationId" = ${organizationId}
      AND p."anonymizedAt" IS NULL AND NOT ${identityIsSubject(subject)}
    ORDER BY p."createdAt", p."id", a."key"`;
}

/**
 * SQL (um SELECT de "id" e "keys"): das participações pedidas, as que
 * mencionam o titular, com as chaves das respostas a retirar. Recalculado
 * na transação da anonimização (anonymize.ts), já com as linhas bloqueadas:
 * só sai o que ainda é o identificador, nunca um campo oculto, e nunca de
 * uma participação do próprio titular (essa é anonimizada por inteiro).
 */
export function subjectMentionKeysSql(
  organizationId: string,
  subject: SubjectIdentifier,
  ids: readonly string[],
): Prisma.Sql {
  return Prisma.sql`
    WITH hidden AS (${hiddenFieldKeys(organizationId)})
    SELECT p."id", array_agg(a."key") AS "keys"
    FROM "Participation" p
    JOIN "Campaign" c ON c."id" = p."campaignId"
    LEFT JOIN hidden h ON h."campaignId" = p."campaignId"
    CROSS JOIN LATERAL (${mentionedAnswers(subject)}) a
    WHERE p."id" IN (${Prisma.join(ids)}) AND c."organizationId" = ${organizationId}
      AND p."anonymizedAt" IS NULL AND NOT ${identityIsSubject(subject)}
    GROUP BY p."id"`;
}

/**
 * Os Participant da organização com o e-mail ou o telefone do titular nos
 * dados antigos (de antes de a identidade passar para a participação),
 * escritos como o visitante os escreveu. A mesma condição na exportação e
 * na eliminação.
 */
export function subjectParticipantCondition(subject: SubjectIdentifier): Prisma.Sql {
  return subject.kind === "email"
    ? Prisma.sql`"email" IS NOT NULL AND ${answerIsSubject(subject, Prisma.sql`"email"`)}`
    : Prisma.sql`"phone" IS NOT NULL AND ${answerIsSubject(subject, Prisma.sql`"phone"`)}`;
}

/**
 * Só o identificador que coincidiu e a data: num quiosque, o código antigo
 * guardava os valores da pessoa anterior nos campos que a seguinte deixava
 * vazios, e o mesmo Participant junta o e-mail de uma e o nome ou o telefone
 * de outra.
 */
export function findSubjectLegacyParticipants(organizationId: string, subject: SubjectIdentifier) {
  const column = subject.kind === "email" ? Prisma.sql`"email"` : Prisma.sql`"phone"`;
  return prisma.$queryRaw<Array<{ value: string; createdAt: Date }>>`
    SELECT ${column} AS "value", "createdAt"
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
