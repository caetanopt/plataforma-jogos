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

function groupCount<T extends string | null>(items: T[]): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = item || "Desconhecido";
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
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
  const campaignIds = campaigns.map((c) => c.id);
  const singleType = filters.campaignId
    ? campaigns[0]?.type
    : filters.type ?? (new Set(campaigns.map((c) => c.type)).size === 1 ? campaigns[0]?.type : undefined);

  const eventWhere = {
    campaignId: { in: campaignIds },
    isTest: false,
    occurredAt: { gte: range.from, lte: range.to },
  };
  const participationWhere = {
    campaignId: { in: campaignIds },
    isTest: false,
    createdAt: { gte: range.from, lte: range.to },
  };

  const [
    viewEvents,
    startEvents,
    blockedEvents,
    participations,
    completedParticipations,
    leadsCount,
  ] = await Promise.all([
    prisma.analyticsEvent.findMany({ where: { ...eventWhere, type: "CAMPAIGN_VIEWED" }, select: { sessionId: true } }),
    prisma.analyticsEvent.count({ where: { ...eventWhere, type: "START_CLICKED" } }),
    prisma.analyticsEvent.count({ where: { ...eventWhere, type: "PARTICIPATION_BLOCKED" } }),
    prisma.participation.findMany({
      where: participationWhere,
      select: {
        id: true,
        status: true,
        source: true,
        deviceType: true,
        browser: true,
        os: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        leadFormResponse: true,
      },
    }),
    prisma.participation.count({ where: { ...participationWhere, status: "COMPLETED" } }),
    prisma.participation.count({ where: { ...participationWhere, leadFormResponse: { not: Prisma.JsonNull } } }),
  ]);

  const views = viewEvents.length;
  const uniqueViews = new Set(viewEvents.map((e) => e.sessionId).filter(Boolean)).size;
  const totalParticipations = participations.length;
  const completedTimes = participations
    .filter((p) => p.completedAt)
    .map((p) => (p.completedAt!.getTime() - p.startedAt.getTime()) / 1000);
  const avgTimeSeconds = completedTimes.length
    ? Math.round(completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length)
    : null;
  const mobileCount = participations.filter((p) => p.deviceType === "mobile").length;

  const timelineMap = new Map<string, number>();
  for (const p of participations) {
    const day = p.createdAt.toISOString().slice(0, 10);
    timelineMap.set(day, (timelineMap.get(day) ?? 0) + 1);
  }
  const timeline = [...timelineMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

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
    avgTimeSeconds,
    mobilePercent: totalParticipations > 0 ? mobileCount / totalParticipations : 0,
    bySource: groupCount(participations.map((p) => p.source)),
    byDevice: groupCount(participations.map((p) => p.deviceType)),
    byBrowser: groupCount(participations.map((p) => p.browser)),
    byOs: groupCount(participations.map((p) => p.os)),
    timeline,
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

async function getMemoryStats(campaignIds: string[], range: DateRange, showParticipantNames: boolean) {
  const results = await prisma.memoryResult.findMany({
    where: {
      participation: {
        campaignId: { in: campaignIds },
        isTest: false,
        createdAt: { gte: range.from, lte: range.to },
      },
    },
    include: {
      participation: {
        include: { campaign: { include: { memoryConfig: true } } },
      },
    },
    orderBy: { score: "desc" },
    take: 500,
  });

  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  // O ranking respeita a configuração por campanha (secção 12): uma
  // campanha com "rankingEnabled" desligado fica fora do ranking (mas
  // continua a contar para as métricas agregadas acima), e uma com
  // "rankingAnonymize" ligado nunca mostra o nome real.
  const rankable = results.filter((r) => r.participation.campaign.memoryConfig?.rankingEnabled !== false);
  const maxEntries = Math.min(
    ...rankable.map((r) => r.participation.campaign.memoryConfig?.rankingMaxEntries ?? 10),
    10,
  );

  return {
    plays: results.length,
    avgScore: Math.round(avg(results.map((r) => r.score))),
    avgTimeSeconds: Math.round(avg(results.map((r) => r.timeSeconds))),
    avgAttempts: Math.round(avg(results.map((r) => r.attempts))),
    completionRate: results.length ? results.filter((r) => r.completed).length / results.length : 0,
    ranking: rankable.slice(0, Number.isFinite(maxEntries) ? maxEntries : 10).map((r) => {
      const anonymize = r.participation.campaign.memoryConfig?.rankingAnonymize ?? false;
      const realName = [r.participation.firstName, r.participation.lastName]
        .filter(Boolean)
        .join(" ");
      return {
        // Nome real só para quem pode ver leads (ver getCampaignStats).
        name: anonymize || !showParticipantNames || !realName ? "Anónimo" : realName,
        score: r.score,
        timeSeconds: r.timeSeconds,
      };
    }),
  };
}

async function getWheelStats(campaignIds: string[], range: DateRange) {
  const participations = await prisma.participation.findMany({
    where: {
      campaignId: { in: campaignIds },
      isTest: false,
      status: "COMPLETED",
      createdAt: { gte: range.from, lte: range.to },
    },
    select: { resultSummary: true },
  });

  const winners = participations.filter((p) => (p.resultSummary as { outcome?: string } | null)?.outcome === "WIN").length;
  const spins = participations.length;

  // "Vencedores" é o resultado do sorteio e não muda; "atribuídos" são os
  // prémios que chegaram a alguém (lead aceite). A diferença são reservas em
  // curso ou libertadas: a distribuição por prémio só conta as atribuídas.
  const awards = await prisma.prizeAward.findMany({
    where: { participation: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } } },
    select: { status: true, releaseReason: true, reservationExpiresAt: true, prize: { select: { publicName: true } } },
  });
  const now = new Date();
  const distributionMap = new Map<string, number>();
  let confirmed = 0;
  let unclaimed = 0;
  let refused = 0;
  for (const award of awards) {
    if (award.status === "CONFIRMED") {
      confirmed += 1;
      distributionMap.set(award.prize.publicName, (distributionMap.get(award.prize.publicName) ?? 0) + 1);
    } else if (award.status === "RELEASED") {
      if (award.releaseReason === "EXPIRED") unclaimed += 1;
      else refused += 1;
    } else if (award.reservationExpiresAt && award.reservationExpiresAt <= now) {
      // Expirada mas ainda por libertar (só um sorteio seguinte a liberta, e
      // numa campanha terminada não há): para as leads já é "fora do prazo".
      unclaimed += 1;
    }
  }

  const prizes = await prisma.prize.findMany({
    where: { campaignId: { in: campaignIds } },
    select: { id: true, publicName: true, totalQuantity: true, awardedQuantity: true },
  });
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
    prizesUnclaimed: unclaimed,
    /** Leads recusadas (duplicado, bot) que tinham um prémio reservado, no período. */
    prizesRefused: refused,
    /** Prémios atribuídos sobre prémios saídos no período. */
    claimRate: awards.length > 0 ? confirmed / awards.length : 0,
    prizeDistribution: [...distributionMap.entries()].map(([prizeName, count]) => ({ prizeName, count })),
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

async function getQuizStats(campaignIds: string[], range: DateRange) {
  const responses = await prisma.quizResponse.findMany({
    where: {
      participation: {
        campaignId: { in: campaignIds },
        isTest: false,
        createdAt: { gte: range.from, lte: range.to },
      },
    },
    include: { participation: true },
  });

  const questions = await prisma.quizQuestion.findMany({
    where: { quizConfig: { campaignId: { in: campaignIds } } },
    include: { answers: true },
    orderBy: { order: "asc" },
  });

  const profiles = await prisma.quizResultProfile.findMany({
    where: { quizConfig: { campaignId: { in: campaignIds } } },
  });

  const started = await prisma.participation.count({
    where: { campaignId: { in: campaignIds }, isTest: false, createdAt: { gte: range.from, lte: range.to } },
  });

  const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  const perQuestion = questions.map((question) => {
    const correctAnswerIds = new Set(question.answers.filter((a) => a.isCorrect).map((a) => a.id));
    let correct = 0;
    let answered = 0;
    for (const response of responses) {
      const answers = response.answers as Array<{ questionId: string; selectedAnswerIds: string[] }>;
      const submission = answers.find((a) => a.questionId === question.id);
      if (!submission) continue;
      answered += 1;
      const selected = new Set(submission.selectedAnswerIds);
      const isCorrect =
        selected.size === correctAnswerIds.size && [...selected].every((id) => correctAnswerIds.has(id));
      if (isCorrect) correct += 1;
    }
    return { title: question.title, correctRate: answered > 0 ? correct / answered : 0, answered };
  });

  const profileCounts = new Map<string, number>();
  for (const response of responses) {
    if (!response.resultProfileId) continue;
    profileCounts.set(response.resultProfileId, (profileCounts.get(response.resultProfileId) ?? 0) + 1);
  }

  return {
    plays: responses.length,
    avgPercentage: Math.round(avg(responses.map((r) => r.percentage))),
    passRate: responses.length ? responses.filter((r) => r.passed === true).length / responses.length : 0,
    avgTimeSeconds: Math.round(avg(responses.map((r) => r.timeSeconds))),
    abandonment: started > 0 ? (started - responses.length) / started : 0,
    perQuestion,
    profiles: profiles.map((profile) => ({ title: profile.title, count: profileCounts.get(profile.id) ?? 0 })),
  };
}
