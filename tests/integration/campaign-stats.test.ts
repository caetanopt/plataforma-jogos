import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import type { CampaignType, Prisma } from "@/generated/prisma/client";
import { getCampaignStats } from "@/features/analytics/campaign-stats";
import type { DateRange } from "@/lib/dates/range";

/**
 * Estatísticas (§20) agregadas na base de dados (passo 7): cada número é
 * conferido contra dados conhecidos, incluindo o que tem de ficar de fora
 * (participações de teste, fora do período, de outra organização).
 */

const FROM = new Date("2026-06-01T00:00:00Z");
const TO = new Date("2026-06-30T23:59:59Z");
const RANGE: DateRange = { preset: "custom", from: FROM, to: TO };
const day = (d: number, hour = 10) => new Date(Date.UTC(2026, 5, d, hour));

const orgIds: string[] = [];
const userIds: string[] = [];

async function createOrg() {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({ data: { name: `Stats ${suffix}`, slug: `stats-${suffix}` } });
  orgIds.push(organization.id);
  const user = await prisma.user.create({ data: { name: "T", email: `stats-${suffix}@example.com`, passwordHash: "x" } });
  userIds.push(user.id);
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Stats", slug: `stats-${suffix}` },
  });
  return { organizationId: organization.id, userId: user.id, workspaceId: workspace.id };
}

type Org = Awaited<ReturnType<typeof createOrg>>;

async function createCampaign(org: Org, type: CampaignType, extra: Partial<Prisma.CampaignCreateInput> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const campaign = await prisma.campaign.create({
    data: {
      organization: { connect: { id: org.organizationId } },
      workspace: { connect: { id: org.workspaceId } },
      owner: { connect: { id: org.userId } },
      type,
      internalName: `${type} ${suffix}`,
      slug: `stats-${suffix}`,
      status: "PUBLISHED",
      ...extra,
    },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: org.userId },
  });
  const participate = (data: Partial<Prisma.ParticipationUncheckedCreateInput> = {}) =>
    prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        idempotencyKey: randomUUID(),
        createdAt: day(10),
        startedAt: day(10),
        ...data,
      },
    });
  return { campaign, participate };
}

let org: Org;
let memory: Awaited<ReturnType<typeof createCampaign>>;
let wheel: Awaited<ReturnType<typeof createCampaign>>;
let quiz: Awaited<ReturnType<typeof createCampaign>>;

beforeAll(async () => {
  org = await createOrg();
  const other = await createOrg();

  // ---- Memória: métricas gerais + jogo
  memory = await createCampaign(org, "MEMORY", {
    memoryConfig: { create: { rankingEnabled: true, rankingMaxEntries: 2 } },
  });
  const events = [
    { type: "CAMPAIGN_VIEWED" as const, sessionId: "s1" },
    { type: "CAMPAIGN_VIEWED" as const, sessionId: "s1" },
    { type: "CAMPAIGN_VIEWED" as const, sessionId: "s2" },
    { type: "CAMPAIGN_VIEWED" as const, sessionId: "s3", isTest: true },
    { type: "CAMPAIGN_VIEWED" as const, sessionId: "s4", occurredAt: new Date("2026-05-01T10:00:00Z") },
    { type: "START_CLICKED" as const, sessionId: "s1" },
    { type: "START_CLICKED" as const, sessionId: "s2" },
    { type: "PARTICIPATION_BLOCKED" as const, sessionId: "s2" },
  ];
  await prisma.analyticsEvent.createMany({
    data: events.map((event) => ({ campaignId: memory.campaign.id, occurredAt: day(10), ...event })),
  });

  const p1 = await memory.participate({
    status: "COMPLETED",
    deviceType: "mobile",
    source: "google.com",
    browser: "Chrome",
    os: "Android",
    startedAt: day(10),
    completedAt: new Date(day(10).getTime() + 60_000),
    leadFormResponse: { email: "a@example.pt" },
    firstName: "Ana",
  });
  const p2 = await memory.participate({
    status: "COMPLETED",
    deviceType: "desktop",
    source: null,
    createdAt: day(11),
    startedAt: day(11),
    completedAt: new Date(day(11).getTime() + 120_000),
    firstName: "Bruno",
  });
  const p3 = await memory.participate({ status: "STARTED", deviceType: "mobile", source: "", firstName: "Carla" });
  // Fora: teste e fora do período.
  const testPlay = await memory.participate({ status: "COMPLETED", isTest: true });
  const oldPlay = await memory.participate({ status: "COMPLETED", createdAt: new Date("2026-05-01T10:00:00Z") });

  await prisma.memoryResult.createMany({
    data: [
      { participationId: p1.id, score: 100, timeSeconds: 30, attempts: 4, pairsFound: 4, completed: true },
      { participationId: p2.id, score: 50, timeSeconds: 60, attempts: 8, pairsFound: 2, completed: false },
      { participationId: p3.id, score: 100, timeSeconds: 20, attempts: 5, pairsFound: 4, completed: true },
      { participationId: testPlay.id, score: 999, timeSeconds: 1, attempts: 1, pairsFound: 4, completed: true },
      { participationId: oldPlay.id, score: 999, timeSeconds: 1, attempts: 1, pairsFound: 4, completed: true },
    ],
  });

  // Outra organização: nunca conta.
  const foreign = await createCampaign(other, "MEMORY", { memoryConfig: { create: {} } });
  await prisma.analyticsEvent.create({
    data: { campaignId: foreign.campaign.id, type: "CAMPAIGN_VIEWED", sessionId: "x", occurredAt: day(10) },
  });
  await foreign.participate({ status: "COMPLETED" });

  // ---- Roda
  wheel = await createCampaign(org, "WHEEL");
  const prize = await prisma.prize.create({
    data: { campaignId: wheel.campaign.id, internalName: "A", publicName: "Voucher A", totalQuantity: 10, awardedQuantity: 1 },
  });
  const spin = async (outcome: "WIN" | "NO_WIN", award?: Partial<Prisma.PrizeAwardUncheckedCreateInput>) => {
    const participation = await wheel.participate({ status: "COMPLETED", resultSummary: { outcome } });
    if (award) {
      await prisma.prizeAward.create({ data: { participationId: participation.id, prizeId: prize.id, ...award } });
    }
  };
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60 * 60_000);
  await spin("WIN", { status: "CONFIRMED" });
  await spin("WIN", { status: "RELEASED", releaseReason: "EXPIRED" });
  await spin("WIN", { status: "RELEASED", releaseReason: "DUPLICATE" });
  await spin("NO_WIN");
  await spin("WIN", { status: "RESERVED", reservationExpiresAt: past });
  await spin("WIN", { status: "RESERVED", reservationExpiresAt: future });

  // ---- Quiz
  quiz = await createCampaign(org, "QUIZ", {
    quizConfig: {
      create: {
        questions: {
          create: [
            {
              order: 0,
              title: "Pergunta 1",
              type: "SINGLE_CHOICE",
              answers: { create: [{ order: 0, text: "Certa", isCorrect: true }, { order: 1, text: "Errada" }] },
            },
            {
              order: 1,
              title: "Pergunta 2",
              type: "MULTIPLE_CHOICE",
              answers: {
                create: [
                  { order: 0, text: "B1", isCorrect: true },
                  { order: 1, text: "B2", isCorrect: true },
                  { order: 2, text: "B3" },
                ],
              },
            },
          ],
        },
        resultProfiles: { create: [{ title: "Perfil A", minPercentage: 50, maxPercentage: 100 }] },
      },
    },
  });
  const config = await prisma.quizConfig.findUniqueOrThrow({
    where: { campaignId: quiz.campaign.id },
    include: { questions: { include: { answers: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } }, resultProfiles: true },
  });
  const [q1, q2] = config.questions;
  const respond = async (data: Omit<Prisma.QuizResponseUncheckedCreateInput, "participationId">) => {
    const participation = await quiz.participate({ status: "COMPLETED" });
    await prisma.quizResponse.create({ data: { participationId: participation.id, ...data } });
  };
  await respond({
    answers: [
      { questionId: q1.id, selectedAnswerIds: [q1.answers[0].id] },
      // Ordem diferente da das respostas certas: continua certa.
      { questionId: q2.id, selectedAnswerIds: [q2.answers[1].id, q2.answers[0].id] },
    ],
    totalScore: 2,
    percentage: 100,
    passed: true,
    timeSeconds: 10,
    resultProfileId: config.resultProfiles[0].id,
  });
  await respond({
    answers: [
      { questionId: q1.id, selectedAnswerIds: [q1.answers[0].id] },
      // Repetida (dados de antes da validação): conta a última, como na
      // pontuação (computeQuizScore).
      { questionId: q1.id, selectedAnswerIds: [q1.answers[1].id] },
    ],
    totalScore: 0,
    percentage: 0,
    passed: false,
    timeSeconds: 30,
  });
  // JSON inesperado (dados antigos): não parte as estatísticas.
  await respond({ answers: { antigo: true }, totalScore: 1, percentage: 50, passed: null, timeSeconds: 20 });
  // Começou e não respondeu.
  await quiz.participate({ status: "STARTED" });
});

afterAll(async () => {
  const where = { organizationId: { in: orgIds } };
  await prisma.participation.deleteMany({ where: { campaign: where } });
  await prisma.campaignVersion.deleteMany({ where: { campaign: where } });
  await prisma.prize.deleteMany({ where: { campaign: where } });
  await prisma.campaign.deleteMany({ where });
  await prisma.workspace.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("estatísticas gerais", () => {
  it("contam só as participações reais do período e da organização", async () => {
    const { general } = await getCampaignStats(org.organizationId, RANGE, { campaignId: memory.campaign.id });

    expect(general).toMatchObject({
      views: 3,
      uniqueViews: 2,
      starts: 2,
      blocked: 1,
      participations: 3,
      completions: 2,
      leads: 1,
      avgTimeSeconds: 90,
    });
    expect(general.startRate).toBeCloseTo(2 / 3);
    expect(general.completionRate).toBeCloseTo(2 / 3);
    expect(general.leadConversion).toBeCloseTo(1 / 3);
    expect(general.mobilePercent).toBeCloseTo(2 / 3);
    expect(general.bySource).toEqual([
      { key: "Desconhecido", count: 2 },
      { key: "google.com", count: 1 },
    ]);
    expect(general.byDevice).toEqual([
      { key: "mobile", count: 2 },
      { key: "desktop", count: 1 },
    ]);
    expect(general.timeline).toEqual([
      { date: "2026-06-10", count: 2 },
      { date: "2026-06-11", count: 1 },
    ]);
  });

  it("sem campanhas que correspondam, tudo a zero", async () => {
    const { general } = await getCampaignStats(org.organizationId, RANGE, { campaignId: "nao-existe" });
    expect(general).toMatchObject({ views: 0, uniqueViews: 0, participations: 0, avgTimeSeconds: null, timeline: [] });
  });
});

describe("Memória", () => {
  it("as médias contam todas as partidas, e o ranking desempata pelo menor tempo", async () => {
    const stats = await getCampaignStats(
      org.organizationId,
      RANGE,
      { campaignId: memory.campaign.id },
      { showParticipantNames: true },
    );

    expect(stats.memory).toMatchObject({ plays: 3, avgScore: 83, avgTimeSeconds: 37, avgAttempts: 6 });
    expect(stats.memory?.completionRate).toBeCloseTo(2 / 3);
    // Limite de 2 posições da campanha; empate a 100 decidido pelo tempo.
    expect(stats.memory?.ranking).toEqual([
      { name: "Carla", score: 100, timeSeconds: 20 },
      { name: "Ana", score: 100, timeSeconds: 30 },
    ]);

    const anonymous = await getCampaignStats(org.organizationId, RANGE, { campaignId: memory.campaign.id });
    expect(anonymous.memory?.ranking.map((row) => row.name)).toEqual(["Anónimo", "Anónimo"]);
  });

  it("uma campanha com ranking de 1 posição e sem jogos não encolhe o ranking das outras", async () => {
    await createCampaign(org, "MEMORY", { memoryConfig: { create: { rankingEnabled: true, rankingMaxEntries: 1 } } });

    const stats = await getCampaignStats(org.organizationId, RANGE, { type: "MEMORY" }, { showParticipantNames: true });

    expect(stats.memory?.ranking.map((row) => row.name)).toEqual(["Carla", "Ana"]);
  });
});

describe("Roda", () => {
  it("separa vencedores, atribuídos, não reclamados e recusados", async () => {
    const { wheel: stats } = await getCampaignStats(org.organizationId, RANGE, { campaignId: wheel.campaign.id });

    expect(stats).toMatchObject({
      spins: 6,
      winners: 5,
      nonWinners: 1,
      prizesAwarded: 1,
      prizesReserved: 1,
      prizesUnclaimed: 2,
      prizesRefused: 1,
      prizeDistribution: [{ prizeName: "Voucher A", count: 1 }],
    });
    expect(stats?.winRate).toBeCloseTo(5 / 6);
    expect(stats?.claimRate).toBeCloseTo(1 / 5);
    expect(stats?.stock).toEqual([{ prizeName: "Voucher A", total: 10, awarded: 1, reserved: 1, remaining: 8 }]);
  });
});

describe("Quiz", () => {
  it("acerto por pergunta, aprovação, abandono e perfis", async () => {
    const { quiz: stats } = await getCampaignStats(org.organizationId, RANGE, { campaignId: quiz.campaign.id });

    expect(stats).toMatchObject({ plays: 3, avgPercentage: 50, avgTimeSeconds: 20, abandonment: 0.25 });
    expect(stats?.passRate).toBeCloseTo(1 / 3);
    expect(stats?.perQuestion).toEqual([
      { title: "Pergunta 1", correctRate: 0.5, answered: 2 },
      { title: "Pergunta 2", correctRate: 1, answered: 1 },
    ]);
    expect(stats?.profiles).toEqual([{ title: "Perfil A", count: 1 }]);
  });
});
