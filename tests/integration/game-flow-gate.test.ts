import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type {
  CampaignStatus,
  DedupStrategy,
  LeadFormPosition,
  ParticipationLimitType,
} from "@/generated/prisma/client";
import type { ParticipationRef } from "@/features/play/types";

/**
 * O servidor impõe o fluxo do jogo (auditoria C3) e cada lead fica com a
 * identidade de quem a preencheu (C4).
 *
 * As server actions correm a sério contra a base de dados; substitui-se só o
 * que depende de um pedido HTTP (IP, sessão do backoffice, Redis).
 */

vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => null }));

const { spinWheelAction, submitLeadFormAction, submitQuizAction } = await import("@/features/play/actions");
const { listLeads } = await import("@/features/leads/queries");
const { toLeadRow } = await import("@/features/leads/format");

interface FixtureOptions {
  type: "WHEEL" | "QUIZ";
  position: LeadFormPosition | null;
  status?: CampaignStatus;
  limitType?: ParticipationLimitType;
  dedupStrategies?: DedupStrategy[];
}

const cleanups: Array<() => Promise<void>> = [];

async function createFixture(options: FixtureOptions) {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Fluxo ${suffix}`, slug: `fluxo-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `fluxo-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Fluxo", slug: `fluxo-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: options.type,
      internalName: `Fluxo ${suffix}`,
      ownerId: user.id,
      slug: `fluxo-${suffix}`,
      status: options.status ?? "PUBLISHED",
      participationLimitType: options.limitType ?? "UNLIMITED",
      dedupStrategies: options.dedupStrategies ?? [],
    },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });

  let regulationId = "";
  let marketingId = "";
  if (options.position) {
    const leadForm = await prisma.leadForm.create({
      data: {
        campaignId: campaign.id,
        position: options.position,
        fields: {
          create: [
            { type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 },
            { type: "FULL_NAME", internalKey: "nome", label: "Nome", order: 1 },
          ],
        },
        consentDefinitions: {
          create: [
            { text: "Aceito o regulamento", required: true, order: 0 },
            { text: "Quero receber novidades", isMarketing: true, order: 1 },
          ],
        },
      },
      include: { consentDefinitions: true },
    });
    regulationId = leadForm.consentDefinitions.find((c) => c.required)!.id;
    marketingId = leadForm.consentDefinitions.find((c) => c.isMarketing)!.id;
  }

  let prizeId = "";
  if (options.type === "WHEEL") {
    const prize = await prisma.prize.create({
      data: { campaignId: campaign.id, internalName: "Voucher", publicName: "Voucher 10€", totalQuantity: 10 },
    });
    prizeId = prize.id;
    await prisma.prizeCode.create({ data: { prizeId: prize.id, code: `COD-${suffix}` } });
    await prisma.wheelConfig.create({
      data: {
        campaignId: campaign.id,
        segments: {
          create: [{ order: 0, name: "Ganhou", colorHex: "#00AEEF", outcome: "WIN", prizeId: prize.id, weight: 1 }],
        },
      },
    });
  } else {
    await prisma.quizConfig.create({
      data: {
        campaignId: campaign.id,
        questions: {
          create: [
            {
              order: 0,
              type: "SINGLE_CHOICE",
              title: "Pergunta",
              answers: { create: [{ order: 0, text: "Certa", isCorrect: true }, { order: 1, text: "Errada" }] },
            },
          ],
        },
      },
    });
  }

  async function participate(cookieId = `cookie-${randomUUID()}`, createdAt?: Date): Promise<ParticipationRef> {
    const participant = await prisma.participant.upsert({
      where: { organizationId_cookieId: { organizationId: organization.id, cookieId } },
      create: { organizationId: organization.id, cookieId },
      update: {},
    });
    const participation = await prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        participantId: participant.id,
        idempotencyKey: randomUUID(),
        ...(createdAt ? { createdAt } : {}),
      },
    });
    return { participationId: participation.id, token: participation.idempotencyKey };
  }

  function lead(ref: ParticipationRef, email: string, nome: string, extra: { honeypot?: string } = {}) {
    return submitLeadFormAction({
      ref,
      values: { email, nome },
      consents: { [regulationId]: true, [marketingId]: false },
      ...extra,
    });
  }

  cleanups.push(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.prizeAward.deleteMany({ where: { participation: { campaignId: campaign.id } } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.participant.deleteMany({ where: { organizationId: organization.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  return { organizationId: organization.id, campaignId: campaign.id, prizeId, participate, lead };
}

async function awardedQuantity(prizeId: string) {
  return (await prisma.prize.findUniqueOrThrow({ where: { id: prizeId } })).awardedQuantity;
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("posse da participação", () => {
  it("sem o token certo não se roda a roda de outra pessoa", async () => {
    const f = await createFixture({ type: "WHEEL", position: null });
    const ref = await f.participate();

    const response = await spinWheelAction({ participationId: ref.participationId, token: randomUUID() });

    expect(response).toEqual({ status: "blocked", reason: "not_found" });
    expect(await awardedQuantity(f.prizeId)).toBe(0);
  });

  it("sem o token certo não se associa uma lead à participação de outra pessoa", async () => {
    const f = await createFixture({ type: "WHEEL", position: "AFTER_GAME" });
    const ref = await f.participate();

    const result = await f.lead({ participationId: ref.participationId, token: randomUUID() }, "intruso@example.com", "X");

    expect(result.ok).toBe(false);
    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.leadFormResponse).toBeNull();
    expect(saved.email).toBeNull();
  });
});

describe("argumentos malformados", () => {
  // As server actions aceitam qualquer valor serializável: um token em falta
  // chegava ao Prisma como undefined (ignorado) e um objeto como filtro.
  const malformed = (participationId: string): unknown[] => [
    { participationId },
    { participationId, token: { not: "" } },
    { participationId, token: undefined },
    { participationId: { not: "" }, token: randomUUID() },
    {},
    null,
    "texto",
  ];

  it("a roda recusa refs sem token ou com filtros e não sorteia", async () => {
    const f = await createFixture({ type: "WHEEL", position: null });
    const ref = await f.participate();

    for (const bad of malformed(ref.participationId)) {
      expect(await spinWheelAction(bad as ParticipationRef)).toEqual({ status: "blocked", reason: "not_found" });
    }
    expect(await awardedQuantity(f.prizeId)).toBe(0);
  });

  it("o formulário recusa refs sem token ou com filtros e não grava nada", async () => {
    const f = await createFixture({ type: "WHEEL", position: "AFTER_GAME" });
    const ref = await f.participate();

    for (const bad of malformed(ref.participationId)) {
      const result = await f.lead(bad as ParticipationRef, "intruso@example.com", "X");
      expect(result.ok).toBe(false);
    }
    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.leadFormResponse).toBeNull();
  });

  it("o quiz recusa um tempo negativo", async () => {
    const f = await createFixture({ type: "QUIZ", position: null });
    const ref = await f.participate();

    expect(await submitQuizAction(ref, [], -60)).toEqual({ status: "blocked", reason: "not_found" });
    expect(await prisma.quizResponse.count({ where: { participationId: ref.participationId } })).toBe(0);
  });
});

describe("formulário antes do jogo", () => {
  it("não se joga sem o formulário submetido", async () => {
    const f = await createFixture({ type: "WHEEL", position: "BEFORE_GAME" });
    const ref = await f.participate();

    expect(await spinWheelAction(ref)).toEqual({ status: "blocked", reason: "lead_missing" });
    expect(await awardedQuantity(f.prizeId)).toBe(0);

    expect((await f.lead(ref, "ana@example.com", "Ana")).ok).toBe(true);
    const response = await spinWheelAction(ref);
    expect(response.status).toBe("revealed");
  });

  it("um bot apanhado pelo honeypot recebe sucesso mas continua sem poder jogar", async () => {
    const f = await createFixture({ type: "WHEEL", position: "BEFORE_GAME" });
    const ref = await f.participate();

    expect((await f.lead(ref, "bot@example.com", "Bot", { honeypot: "http://spam" })).ok).toBe(true);
    expect(await spinWheelAction(ref)).toEqual({ status: "blocked", reason: "lead_missing" });
  });

  it("recusa a lead sem o consentimento obrigatório", async () => {
    const f = await createFixture({ type: "WHEEL", position: "BEFORE_GAME" });
    const ref = await f.participate();

    const result = await submitLeadFormAction({ ref, values: { email: "ana@example.com" }, consents: {} });

    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(await spinWheelAction(ref)).toEqual({ status: "blocked", reason: "lead_missing" });
  });
});

describe("estado da campanha", () => {
  it("não se roda com a campanha pausada, mas um resultado já gravado continua a ser devolvido", async () => {
    const f = await createFixture({ type: "WHEEL", position: null });
    const played = await f.participate();
    const fresh = await f.participate();
    const first = await spinWheelAction(played);
    expect(first.status).toBe("revealed");

    await prisma.campaign.update({ where: { id: f.campaignId }, data: { status: "PAUSED" } });

    expect(await spinWheelAction(fresh)).toEqual({ status: "blocked", reason: "not_active" });
    expect(await spinWheelAction(played)).toEqual(first);
    expect(await awardedQuantity(f.prizeId)).toBe(1);
  });

  it("um quiz começado com a campanha ativa pode terminar depois de ela ser pausada", async () => {
    const f = await createFixture({ type: "QUIZ", position: null });
    const ref = await f.participate();
    await prisma.campaign.update({ where: { id: f.campaignId }, data: { status: "PAUSED" } });

    const response = await submitQuizAction(ref, [], 30);

    expect(response.status).toBe("revealed");
  });
});

describe("antes de revelar o resultado", () => {
  it("roda: nada chega ao browser nem se sorteia antes do formulário", async () => {
    const f = await createFixture({ type: "WHEEL", position: "BEFORE_RESULT" });
    const ref = await f.participate();

    const before = await spinWheelAction(ref);
    expect(before).toEqual({ status: "lead_required" });
    // Sem sorteio antes do formulário: uma lead recusada ou abandonada não
    // prende um prémio nem um código.
    expect(await awardedQuantity(f.prizeId)).toBe(0);

    expect((await f.lead(ref, "ana@example.com", "Ana")).ok).toBe(true);
    const after = await spinWheelAction(ref);

    expect(after.status).toBe("revealed");
    if (after.status === "revealed") {
      expect(after.result.outcome).toBe("WIN");
      expect(after.result.prize?.publicName).toBe("Voucher 10€");
    }
    // Revelar não é sortear outra vez nem contar outra conclusão.
    expect(await awardedQuantity(f.prizeId)).toBe(1);
    const completions = await prisma.analyticsEvent.count({
      where: { campaignId: f.campaignId, type: "GAME_COMPLETED" },
    });
    expect(completions).toBe(1);
  });

  it("quiz: a pontuação só chega depois do formulário", async () => {
    const f = await createFixture({ type: "QUIZ", position: "BEFORE_RESULT" });
    const ref = await f.participate();
    const question = await prisma.quizQuestion.findFirstOrThrow({
      where: { quizConfig: { campaignId: f.campaignId } },
      include: { answers: true },
    });
    const correct = question.answers.find((a) => a.isCorrect)!;
    const submissions = [{ questionId: question.id, selectedAnswerIds: [correct.id] }];

    expect(await submitQuizAction(ref, submissions, 12)).toEqual({ status: "lead_required" });

    await f.lead(ref, "ana@example.com", "Ana");
    const after = await submitQuizAction(ref, submissions, 12);
    expect(after.status).toBe("revealed");
    if (after.status === "revealed") expect(after.result.percentage).toBe(100);
  });
});

describe("antes de revelar o prémio", () => {
  it("a roda mostra que ganhou, mas o prémio e o código só seguem depois do formulário", async () => {
    const f = await createFixture({ type: "WHEEL", position: "BEFORE_PRIZE" });
    const ref = await f.participate();

    const before = await spinWheelAction(ref);
    expect(before.status).toBe("revealed");
    if (before.status !== "revealed") return;
    expect(before.result.outcome).toBe("WIN");
    expect(before.result.prize).toBeNull();
    expect(before.result.prizePending).toBe(true);
    expect(JSON.stringify(before)).not.toContain("Voucher");
    expect(JSON.stringify(before)).not.toContain("COD-");

    await f.lead(ref, "ana@example.com", "Ana");
    const after = await spinWheelAction(ref);
    if (after.status !== "revealed") throw new Error("esperava o resultado revelado");
    expect(after.result.prize?.publicName).toBe("Voucher 10€");
    expect(after.result.prize?.code).toMatch(/^COD-/);
    expect(after.result.prizePending).toBe(false);
  });
});

describe("submissão do formulário", () => {
  it("é idempotente: repetir não grava outra vez nem duplica consentimentos", async () => {
    const f = await createFixture({ type: "WHEEL", position: "AFTER_GAME" });
    const ref = await f.participate();

    await f.lead(ref, "ana@example.com", "Ana");
    const repeated = await f.lead(ref, "outra@example.com", "Outra");

    expect(repeated.ok).toBe(true);
    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.email).toBe("ana@example.com");
    expect(await prisma.consentRecord.count({ where: { participationId: ref.participationId } })).toBe(2);
  });

  it("só guarda os campos que o formulário tem", async () => {
    const f = await createFixture({ type: "WHEEL", position: "AFTER_GAME" });
    const ref = await f.participate();

    await submitLeadFormAction({
      ref,
      values: { email: "ana@example.com", nome: "Ana", injetado: "<script>" },
      consents: {},
    });
    // Sem o consentimento obrigatório é recusado; repete-se com ele.
    const lf = await prisma.leadForm.findUniqueOrThrow({
      where: { campaignId: f.campaignId },
      include: { consentDefinitions: true },
    });
    await submitLeadFormAction({
      ref,
      values: { email: "ana@example.com", nome: "Ana", injetado: "<script>" },
      consents: Object.fromEntries(lf.consentDefinitions.map((c) => [c.id, true])),
    });

    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.leadFormResponse).toEqual({ email: "ana@example.com", nome: "Ana" });
  });
});

describe("identidade de cada lead (dispositivo partilhado)", () => {
  it("duas pessoas no mesmo browser ficam cada uma com a sua lead", async () => {
    const f = await createFixture({ type: "WHEEL", position: "AFTER_GAME" });
    const kiosk = `kiosk-${randomUUID()}`;
    const ana = await f.participate(kiosk);
    await f.lead(ana, "Ana@Example.com", "Ana");
    const rui = await f.participate(kiosk);
    await f.lead(rui, "rui@example.com", "Rui");

    const range = { preset: "all" as const, from: new Date(0), to: new Date(Date.now() + 60_000) };
    const leads = await listLeads(f.organizationId, range, { campaignId: f.campaignId });
    const rows = leads.items.map((item) => toLeadRow(item));
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(ana.participationId)).toMatchObject({ name: "Ana", email: "ana@example.com" });
    expect(byId.get(rui.participationId)).toMatchObject({ name: "Rui", email: "rui@example.com" });

    const searched = await listLeads(f.organizationId, range, { campaignId: f.campaignId, search: "ana@" });
    expect(searched.items.map((p) => p.id)).toEqual([ana.participationId]);
  });
});

describe("controlo de duplicados por e-mail", () => {
  it("bloqueia o mesmo e-mail noutra participação, sem distinguir maiúsculas", async () => {
    const f = await createFixture({
      type: "WHEEL",
      position: "AFTER_GAME",
      limitType: "ONE_TOTAL",
      dedupStrategies: ["EMAIL"],
    });
    const first = await f.participate();
    const second = await f.participate();

    expect((await f.lead(first, "ana@example.com", "Ana")).ok).toBe(true);
    expect(await f.lead(second, "  ANA@example.com ", "Ana")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("quem volta depois da janela é aceite — a participação em curso não conta contra si própria", async () => {
    const f = await createFixture({
      type: "WHEEL",
      position: "AFTER_GAME",
      limitType: "ONE_PER_DAY",
      dedupStrategies: ["EMAIL"],
    });
    const cookie = `cookie-${randomUUID()}`;
    const yesterday = await f.participate(cookie, new Date(Date.now() - 25 * 60 * 60 * 1000));
    expect((await f.lead(yesterday, "ana@example.com", "Ana")).ok).toBe(true);

    const today = await f.participate(cookie);
    expect((await f.lead(today, "ana@example.com", "Ana")).ok).toBe(true);
  });
});
