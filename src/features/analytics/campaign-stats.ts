import { prisma } from "@/server/db/client";
import { activeReservationsByPrize, remainingStock } from "@/features/prizes/stock";
import { Prisma, type CampaignType } from "@/generated/prisma/client";
import type { DateRange } from "@/lib/dates/range";

export interface CampaignStatsFilters {
  campaignId?: string;
  workspaceId?: string;
  folderId?: string;
  type?: CampaignType;
}

/**
 * Estatísticas (§20), agregadas na base de dados.
 *
 * Antes carregavam para memória todos os eventos de visualização e todas as
 * participações do período (com as respostas do formulário, dados pessoais
 * que nem eram usados), e cada pedido a /analytics crescia com a campanha.
 * As médias da Memória eram calculadas só sobre as 500 melhores pontuações.
 * Agora cada número é um COUNT/AVG/GROUP BY: o custo depende dos índices,
 * não do número de participações.
 */

const UNKNOWN = "Desconhecido";

/** Junta vazio e null em "Desconhecido" e ordena por contagem. */
function breakdown(rows: Array<{ key: string | null; count: number }>): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.key || UNKNOWN;
    map.set(key, (map.get(key) ?? 0) + row.count);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

async function groupParticipationsBy(
  where: Prisma.ParticipationWhereInput,
  field: "source" | "deviceType" | "browser" | "os",
): Promise<Array<{ key: string; count: number }>> {
  const rows = await prisma.participation.groupBy({ by: [field], where, _count: { _all: true } });
  return breakdown(rows.map((row) => ({ key: row[field], count: row._count._all })));
}

/** Filtro SQL das participações reais das campanhas no período. */
function participationSql(campaignIds: string[], range: DateRange, alias = ""): Prisma.Sql {
  const column = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.sql`${column("campaignId")} IN (${Prisma.join(campaignIds)})
    AND ${column("isTest")} = false
    AND ${column("createdAt")} >= ${range.from} AND ${column("createdAt")} <= ${range.to}`;
}

export async function getCampaignStats(
  organizationId: string,
  range: DateRange,
  filters: CampaignStatsFilters,
  options: { showParticipantNames: boolean } = { showParticipantNames: false },
) {
  const campaignWhere = {
    organizationId,
    ...(filters.campaignId ? { id: filters.campaignId } : {}),
    ...(filters.workspaceId ? { workspaceId: filters.workspaceId } : {}),
    ...(filters.folderId ? { folderId: filters.folderId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };

  const campaigns = await prisma.campaign.findMany({ where: campaignWhere, select: { id: true, type: true } });
  // Sem campanhas, "IN ()" não é SQL válido: um id que nunca existe.
  const campaignIds = campaigns.length > 0 ? campaigns.map((c) => c.id) : ["-"];
  const singleType = filters.campaignId
    ? campaigns[0]?.type
    : filters.type ?? (new Set(campaigns.map((c) => c.type)).size === 1 ? campaigns[0]?.type : undefined);

  const participationWhere: Prisma.ParticipationWhereInput = {
    campaignId: { in: campaignIds },
    isTest: false,
    createdAt: { gte: range.from, lte: range.to },
  };

  // As contagens de cada tabela numa só query (COUNT ... FILTER): antes eram
  // 14 queries em paralelo por pedido, que num pool de 10 ligações punham
  // os pedidos do jogo público à espera.
  const [eventRows, participationRows, timelineRows, bySource, byDevice, byBrowser, byOs] = await Promise.all([
    prisma.$queryRaw<Array<{ views: number; uniqueViews: number; starts: number; blocked: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE "type" = 'CAMPAIGN_VIEWED')::int AS views,
        COUNT(DISTINCT "sessionId") FILTER (WHERE "type" = 'CAMPAIGN_VIEWED')::int AS "uniqueViews",
        COUNT(*) FILTER (WHERE "type" = 'START_CLICKED')::int AS starts,
        COUNT(*) FILTER (WHERE "type" = 'PARTICIPATION_BLOCKED')::int AS blocked
      FROM "AnalyticsEvent"
      WHERE "campaignId" IN (${Prisma.join(campaignIds)})
        -- O tipo no WHERE, não só nos FILTER: sem ele, o índice
        -- (campaignId, type, occurredAt) não limita a data e a query lia
        -- todos os eventos da campanha (ou a tabela inteira).
        AND "type" IN ('CAMPAIGN_VIEWED', 'START_CLICKED', 'PARTICIPATION_BLOCKED')
        AND "isTest" = false
        AND "occurredAt" >= ${range.from} AND "occurredAt" <= ${range.to}`,
    // Leads: com resposta ao formulário (nem NULL nem JSON null).
    prisma.$queryRaw<
      Array<{ total: number; completed: number; leads: number; mobile: number; avgTime: number | null }>
    >`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "status" = 'COMPLETED')::int AS completed,
        COUNT(*) FILTER (WHERE "leadFormResponse" IS NOT NULL AND "leadFormResponse" <> 'null'::jsonb)::int AS leads,
        COUNT(*) FILTER (WHERE "deviceType" = 'mobile')::int AS mobile,
        (AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))) FILTER (WHERE "completedAt" IS NOT NULL))::float8
          AS "avgTime"
      FROM "Participation"
      WHERE ${participationSql(campaignIds, range)}`,
    // Dias em UTC, como antes (toISOString).
    prisma.$queryRaw<Array<{ date: string; count: number }>>`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
      FROM "Participation"
      WHERE ${participationSql(campaignIds, range)}
      GROUP BY 1
      ORDER BY 1`,
    groupParticipationsBy(participationWhere, "source"),
    groupParticipationsBy(participationWhere, "deviceType"),
    groupParticipationsBy(participationWhere, "browser"),
    groupParticipationsBy(participationWhere, "os"),
  ]);

  const { views, uniqueViews, starts: startEvents, blocked: blockedEvents } = eventRows[0] ?? {
    views: 0,
    uniqueViews: 0,
    starts: 0,
    blocked: 0,
  };
  const {
    total: totalParticipations,
    completed: completedParticipations,
    leads: leadsCount,
    mobile: mobileCount,
    avgTime,
  } = participationRows[0] ?? { total: 0, completed: 0, leads: 0, mobile: 0, avgTime: null };
  const general = {
    views,
    uniqueViews,
    starts: startEvents,
    participations: totalParticipations,
    completions: completedParticipations,
    leads: leadsCount,
    blocked: blockedEvents,
    startRate: views > 0 ? startEvents / views : 0,
    completionRate: totalParticipations > 0 ? completedParticipations / totalParticipations : 0,
    leadConversion: views > 0 ? leadsCount / views : 0,
    avgTimeSeconds: avgTime != null ? Math.round(avgTime) : null,
    mobilePercent: totalParticipations > 0 ? mobileCount / totalParticipations : 0,
    bySource,
    byDevice,
    byBrowser,
    byOs,
    timeline: timelineRows.map((row) => ({ date: row.date, count: row.count })),
  };

  const result: {
    general: typeof general;
    memory?: Awaited<ReturnType<typeof getMemoryStats>>;
    wheel?: Awaited<ReturnType<typeof getWheelStats>>;
    quiz?: Awaited<ReturnType<typeof getQuizStats>>;
  } = { general };

  if (singleType === "MEMORY") {
    result.memory = await getMemoryStats(campaignIds, range, options.showParticipantNames);
  } else if (singleType === "WHEEL") {
    result.wheel = await getWheelStats(campaignIds, range);
  } else if (singleType === "QUIZ") {
    result.quiz = await getQuizStats(campaignIds, range);
  }

  return result;
}

const MAX_RANKING_ENTRIES = 10;

async function getMemoryStats(campaignIds: string[], range: DateRange, showParticipantNames: boolean) {
  const where: Prisma.MemoryResultWhereInput = {
    participation: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } },
  };

  // O ranking respeita a configuração por campanha (secção 12): só entram
  // as campanhas com o ranking ligado, com o menor limite de posições entre
  // elas, e uma com "rankingAnonymize" nunca mostra o nome real.
  const enabledConfigs = await prisma.memoryGameConfig.findMany({
    where: { campaignId: { in: campaignIds }, rankingEnabled: true },
    select: { campaignId: true, rankingMaxEntries: true },
  });
  // Só contam as campanhas com jogos no período: uma com o ranking ligado e
  // sem resultados (limite de 1, por exemplo) encolhia o ranking das outras.
  const playedCampaigns =
    enabledConfigs.length > 0
      ? new Set(
          (
            await prisma.participation.groupBy({
              by: ["campaignId"],
              where: {
                campaignId: { in: enabledConfigs.map((config) => config.campaignId) },
                isTest: false,
                createdAt: { gte: range.from, lte: range.to },
                memoryResult: { isNot: null },
              },
            })
          ).map((row) => row.campaignId),
        )
      : new Set<string>();
  const rankingConfigs = enabledConfigs.filter((config) => playedCampaigns.has(config.campaignId));
  const maxEntries = Math.min(
    MAX_RANKING_ENTRIES,
    ...rankingConfigs.map((config) => config.rankingMaxEntries ?? MAX_RANKING_ENTRIES),
  );

  const loadRanking = () =>
    prisma.memoryResult.findMany({
      where: {
        participation: {
          campaignId: { in: rankingConfigs.map((config) => config.campaignId) },
          isTest: false,
          createdAt: { gte: range.from, lte: range.to },
        },
      },
      // Desempate pelo menor tempo (§12), depois pela primeira a chegar.
      orderBy: [{ score: "desc" }, { timeSeconds: "asc" }, { participation: { createdAt: "asc" } }],
      take: maxEntries,
      select: {
        score: true,
        timeSeconds: true,
        participation: {
          select: {
            firstName: true,
            lastName: true,
            campaign: { select: { memoryConfig: { select: { rankingAnonymize: true } } } },
          },
        },
      },
    });

  const [aggregate, completed, ranking] = await Promise.all([
    prisma.memoryResult.aggregate({
      where,
      _count: { _all: true },
      _avg: { score: true, timeSeconds: true, attempts: true },
    }),
    prisma.memoryResult.count({ where: { ...where, completed: true } }),
    rankingConfigs.length > 0 && maxEntries > 0 ? loadRanking() : [],
  ]);

  const plays = aggregate._count._all;
  return {
    plays,
    avgScore: Math.round(aggregate._avg.score ?? 0),
    avgTimeSeconds: Math.round(aggregate._avg.timeSeconds ?? 0),
    avgAttempts: Math.round(aggregate._avg.attempts ?? 0),
    completionRate: plays > 0 ? completed / plays : 0,
    ranking: ranking.map((row) => {
      const anonymize = row.participation.campaign.memoryConfig?.rankingAnonymize ?? false;
      const realName = [row.participation.firstName, row.participation.lastName].filter(Boolean).join(" ");
      return {
        // Nome real só para quem pode ver leads (ver getCampaignStats).
        name: anonymize || !showParticipantNames || !realName ? "Anónimo" : realName,
        score: row.score,
        timeSeconds: row.timeSeconds,
      };
    }),
  };
}

async function getWheelStats(campaignIds: string[], range: DateRange) {
  const spinWhere: Prisma.ParticipationWhereInput = {
    campaignId: { in: campaignIds },
    isTest: false,
    status: "COMPLETED",
    createdAt: { gte: range.from, lte: range.to },
  };
  const awardWhere: Prisma.PrizeAwardWhereInput = {
    participation: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } },
  };
  const now = new Date();

  // "Vencedores" é o resultado do sorteio e não muda; "atribuídos" são os
  // prémios que chegaram a alguém (lead aceite). A diferença são reservas em
  // curso ou libertadas: a distribuição por prémio só conta as atribuídas.
  const [spins, winners, awardGroups, expiredReserved, confirmedByPrize, prizes] = await Promise.all([
    prisma.participation.count({ where: spinWhere }),
    prisma.participation.count({ where: { ...spinWhere, resultSummary: { path: ["outcome"], equals: "WIN" } } }),
    prisma.prizeAward.groupBy({ by: ["status", "releaseReason"], where: awardWhere, _count: { _all: true } }),
    // Expirada mas ainda por libertar (só um sorteio seguinte a liberta, e
    // numa campanha terminada não há): para as leads já é "fora do prazo".
    prisma.prizeAward.count({ where: { ...awardWhere, status: "RESERVED", reservationExpiresAt: { lte: now } } }),
    prisma.prizeAward.groupBy({ by: ["prizeId"], where: { ...awardWhere, status: "CONFIRMED" }, _count: { _all: true } }),
    prisma.prize.findMany({
      where: { campaignId: { in: campaignIds } },
      select: { id: true, publicName: true, totalQuantity: true, awardedQuantity: true },
    }),
  ]);

  let totalAwards = 0;
  let confirmed = 0;
  let releasedExpired = 0;
  let refused = 0;
  for (const group of awardGroups) {
    const count = group._count._all;
    totalAwards += count;
    if (group.status === "CONFIRMED") confirmed += count;
    else if (group.status === "RELEASED") {
      if (group.releaseReason === "EXPIRED") releasedExpired += count;
      else refused += count;
    }
  }

  const prizeName = new Map(prizes.map((prize) => [prize.id, prize.publicName]));
  const distributionMap = new Map<string, number>();
  for (const group of confirmedByPrize) {
    const name = prizeName.get(group.prizeId) ?? UNKNOWN;
    distributionMap.set(name, (distributionMap.get(name) ?? 0) + group._count._all);
  }

  // Retrato do momento, independente do período (como os alertas).
  const reservedByPrize = await activeReservationsByPrize(prizes.map((p) => p.id));
  const reservedNow = [...reservedByPrize.values()].reduce((sum, count) => sum + count, 0);

  return {
    spins,
    winners,
    nonWinners: spins - winners,
    winRate: spins > 0 ? winners / spins : 0,
    prizesAwarded: confirmed,
    /** Reservas à espera da lead, agora. */
    prizesReserved: reservedNow,
    /** Reservas cujo formulário não chegou a tempo, no período. */
    prizesUnclaimed: releasedExpired + expiredReserved,
    /** Leads recusadas (duplicado, bot) que tinham um prémio reservado, no período. */
    prizesRefused: refused,
    /** Prémios atribuídos sobre prémios saídos no período. */
    claimRate: totalAwards > 0 ? confirmed / totalAwards : 0,
    prizeDistribution: [...distributionMap.entries()].map(([name, count]) => ({ prizeName: name, count })),
    stock: prizes.map((p) => {
      const reserved = reservedByPrize.get(p.id) ?? 0;
      return {
        prizeName: p.publicName,
        total: p.totalQuantity,
        awarded: p.awardedQuantity,
        reserved,
        remaining: remainingStock(p, reserved),
      };
    }),
  };
}

/** A mesma comparação da pontuação (sameAnswerSet em quiz-game/scoring.ts). */
function sameAnswers(selected: unknown, correct: ReadonlySet<string>): boolean {
  if (!Array.isArray(selected) || selected.length !== correct.size) return false;
  return selected.every((id) => typeof id === "string" && correct.has(id));
}

async function getQuizStats(campaignIds: string[], range: DateRange) {
  const responseWhere: Prisma.QuizResponseWhereInput = {
    participation: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } },
  };

  const [aggregate, passed, profileGroups, started, questions, profiles, answerGroups] = await Promise.all([
    prisma.quizResponse.aggregate({
      where: responseWhere,
      _count: { _all: true },
      _avg: { percentage: true, timeSeconds: true },
    }),
    prisma.quizResponse.count({ where: { ...responseWhere, passed: true } }),
    prisma.quizResponse.groupBy({ by: ["resultProfileId"], where: responseWhere, _count: { _all: true } }),
    prisma.participation.count({
      where: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } },
    }),
    prisma.quizQuestion.findMany({
      where: { quizConfig: { campaignId: { in: campaignIds } } },
      select: { id: true, title: true, answers: { where: { isCorrect: true }, select: { id: true } } },
      orderBy: { order: "asc" },
    }),
    prisma.quizResultProfile.findMany({
      where: { quizConfig: { campaignId: { in: campaignIds } } },
      select: { id: true, title: true },
    }),
    // Uma linha por (pergunta, combinação de respostas escolhidas): o número
    // de linhas depende das combinações, não das participações. Com uma
    // pergunta submetida mais de uma vez (dados de antes da validação), a
    // última, como no cálculo da pontuação. O DISTINCT ON corre dentro de
    // cada resposta: ordenar todas as submissões juntas ia para disco.
    prisma.$queryRaw<Array<{ questionId: string | null; selected: unknown; count: number }>>`
      SELECT last."questionId", last.selected, COUNT(*)::int AS count
      FROM "QuizResponse" r
      JOIN "Participation" p ON p.id = r."participationId"
      CROSS JOIN LATERAL (
        SELECT DISTINCT ON (element->>'questionId')
          element->>'questionId' AS "questionId",
          element->'selectedAnswerIds' AS selected
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.answers) = 'array' THEN r.answers ELSE '[]'::jsonb END
        ) WITH ORDINALITY AS submission(element, position)
        ORDER BY element->>'questionId', position DESC
      ) last
      WHERE ${participationSql(campaignIds, range, "p")}
      GROUP BY 1, 2`,
  ]);

  const perQuestion = questions.map((question) => {
    const correctIds = new Set(question.answers.map((answer) => answer.id));
    let answered = 0;
    let correct = 0;
    for (const group of answerGroups) {
      if (group.questionId !== question.id) continue;
      answered += group.count;
      if (sameAnswers(group.selected, correctIds)) correct += group.count;
    }
    return { title: question.title, correctRate: answered > 0 ? correct / answered : 0, answered };
  });

  const profileCounts = new Map(profileGroups.map((group) => [group.resultProfileId, group._count._all]));
  const plays = aggregate._count._all;

  return {
    plays,
    avgPercentage: Math.round(aggregate._avg.percentage ?? 0),
    passRate: plays > 0 ? passed / plays : 0,
    avgTimeSeconds: Math.round(aggregate._avg.timeSeconds ?? 0),
    abandonment: started > 0 ? (started - plays) / started : 0,
    perQuestion,
    profiles: profiles.map((profile) => ({ title: profile.title, count: profileCounts.get(profile.id) ?? 0 })),
  };
}
