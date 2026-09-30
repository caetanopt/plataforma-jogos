import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { CampaignType, LeadFieldType, LeadFormPosition } from "@/generated/prisma/client";

/**
 * Retoma depois de recarregar (secção 7), relógio do servidor (12, 14),
 * formulário vazio, idade mínima, telefone e posição fixada por participação
 * (11, 16). As server actions correm contra a base de dados; só se
 * substitui o que depende de um pedido HTTP.
 */

vi.mock("@/server/auth", () => ({ auth: async () => null }));
const rateLimit = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: rateLimit.allowed, remaining: rateLimit.allowed ? 10 : 0 }),
}));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => null }));
const visitor = vi.hoisted(() => ({ cookieId: "" }));
vi.mock("@/features/play/cookie", () => ({ getOrCreateVisitorCookieId: async () => visitor.cookieId }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest" }) }));

const {
  beginGameAction,
  getStoredResultAction,
  resumeParticipationAction,
  startParticipationAction,
  submitLeadFormAction,
  submitMemoryResultAction,
} = await import("@/features/play/actions");

interface Options {
  type?: CampaignType;
  position?: LeadFormPosition | null;
  fields?: Array<{ type: LeadFieldType; internalKey: string; required?: boolean; defaultValue?: string }>;
  consents?: boolean;
  minAge?: number;
  dedupStrategies?: Array<"EMAIL" | "PHONE">;
}

const cleanups: Array<() => Promise<void>> = [];

async function createFixture(options: Options = {}) {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({ data: { name: `Retoma ${suffix}`, slug: `retoma-${suffix}` } });
  const user = await prisma.user.create({ data: { name: "T", email: `retoma-${suffix}@example.com`, passwordHash: "x" } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Retoma", slug: `retoma-${suffix}` },
  });
  const type = options.type ?? "MEMORY";
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type,
      internalName: `Retoma ${suffix}`,
      ownerId: user.id,
      slug: `retoma-${suffix}`,
      status: "PUBLISHED",
      minAge: options.minAge,
      dedupStrategies: options.dedupStrategies ?? [],
      participationLimitType: options.dedupStrategies ? "ONE_TOTAL" : "UNLIMITED",
      memoryConfig:
        type === "MEMORY"
          ? {
              create: {
                timeLimitSeconds: 60,
                pairs: {
                  create: [
                    { order: 0, kind: "TEXT_TEXT", cardAText: "A", cardBText: "A" },
                    { order: 1, kind: "TEXT_TEXT", cardAText: "B", cardBText: "B" },
                  ],
                },
              },
            }
          : undefined,
    },
  });
  await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });
  let leadFormId = "";
  if (options.position !== null) {
    const form = await prisma.leadForm.create({
      data: {
        campaignId: campaign.id,
        position: options.position ?? "BEFORE_GAME",
        fields: {
          create: (options.fields ?? [{ type: "EMAIL" as const, internalKey: "email", required: true }]).map((field, order) => ({
            type: field.type,
            internalKey: field.internalKey,
            label: field.internalKey,
            required: field.required ?? false,
            defaultValue: field.defaultValue,
            order,
          })),
        },
        consentDefinitions: options.consents ? { create: [{ text: "Aceito", required: true, order: 0 }] } : undefined,
      },
    });
    leadFormId = form.id;
  }

  cleanups.push(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.participant.deleteMany({ where: { organizationId: organization.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  const start = (idempotencyKey = randomUUID()) =>
    startParticipationAction({
      campaignId: campaign.id,
      idempotencyKey,
      sessionId: randomUUID(),
      testRequested: false,
    });

  return { campaignId: campaign.id, leadFormId, start };
}

afterEach(async () => {
  rateLimit.allowed = true;
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("retoma depois de recarregar a página", () => {
  it("devolve a mesma participação, com o formulário e o ponto em que ficou", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_GAME" });
    const token = randomUUID();
    const started = await fixture.start(token);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.leadForm?.position).toBe("BEFORE_GAME");

    const resumed = await resumeParticipationAction({
      campaignId: fixture.campaignId,
      ref: { participationId: started.participationId, token },
      testRequested: false,
    });
    expect(resumed).toMatchObject({ ok: true, participationId: started.participationId, leadSubmitted: false, completed: false });

    // Repetir o início com a mesma chave (F5 a meio do pedido) não cria outra.
    const again = await fixture.start(token);
    expect(again.ok && again.participationId).toBe(started.participationId);
    expect(await prisma.participation.count({ where: { campaignId: fixture.campaignId } })).toBe(1);
  });

  it("recusa sem o token certo, noutra campanha ou noutro modo", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const other = await createFixture({ position: null });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");

    const ref = { participationId: started.participationId, token };
    expect(await resumeParticipationAction({ campaignId: fixture.campaignId, ref: { ...ref, token: randomUUID() }, testRequested: false })).toEqual({ ok: false, reason: "gone" });
    expect(await resumeParticipationAction({ campaignId: other.campaignId, ref, testRequested: false })).toEqual({ ok: false, reason: "gone" });
    // Uma participação de teste não é retomada numa página em modo real (o
    // modo é decidido no servidor; aqui não há sessão do backoffice).
    await prisma.participation.update({ where: { id: ref.participationId }, data: { isTest: true } });
    expect(await resumeParticipationAction({ campaignId: fixture.campaignId, ref, testRequested: true })).toEqual({ ok: false, reason: "gone" });
    await prisma.participation.update({ where: { id: ref.participationId }, data: { isTest: false } });
    // A mesma chave noutra campanha não abre a participação de cá.
    const conflict = await other.start(token);
    expect(conflict).toEqual({ ok: false, reason: "not_found" });
  });

  it("uma participação terminada há mais de 2 horas já não é retomada", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    await prisma.participation.update({
      where: { id: started.participationId },
      data: { resultSummary: { score: 1 }, status: "COMPLETED", completedAt: new Date(Date.now() - 3 * 3600_000) },
    });
    expect(
      await resumeParticipationAction({
        campaignId: fixture.campaignId,
        ref: { participationId: started.participationId, token },
        testRequested: false,
      }),
    ).toEqual({ ok: false, reason: "gone" });
  });
});

describe("retoma: falha temporária ou definitiva", () => {
  it("com o rate limit, a retoma diz para tentar de novo em vez de dar a participação por perdida", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const input = { campaignId: fixture.campaignId, ref: { participationId: started.participationId, token }, testRequested: false };

    rateLimit.allowed = false;
    expect(await resumeParticipationAction(input)).toEqual({ ok: false, reason: "retry" });
    rateLimit.allowed = true;
    expect(await resumeParticipationAction(input)).toMatchObject({ ok: true, participationId: started.participationId });
  });
});

describe("resultado guardado (retoma da memória e do quiz)", () => {
  it("«Antes de revelar o resultado»: retido até à lead, depois devolvido sem jogar de novo", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_RESULT" });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const ref = { participationId: started.participationId, token };

    // Ainda sem resultado: nada para mostrar.
    expect(await getStoredResultAction(ref)).toEqual({ status: "blocked", reason: "not_found" });

    expect(await beginGameAction(ref)).toEqual({ ok: true });
    expect(await submitMemoryResultAction({ ref, attempts: 2, pairsFound: 2, timeSeconds: 5 })).toEqual({
      status: "lead_required",
    });
    expect(await getStoredResultAction(ref)).toEqual({ status: "lead_required" });

    expect(await submitLeadFormAction({ ref, values: { email: "ana@example.pt" }, consents: {} })).toEqual({ ok: true });
    const stored = await getStoredResultAction(ref);
    expect(stored).toEqual({ status: "revealed", result: { kind: "MEMORY", result: { score: expect.any(Number), completed: true } } });
    expect(await prisma.memoryResult.count({ where: { participationId: ref.participationId } })).toBe(1);
  });

  it("exige o token da participação", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const started = await fixture.start();
    if (!started.ok) throw new Error("start");

    expect(await getStoredResultAction({ participationId: started.participationId, token: randomUUID() })).toEqual({
      status: "blocked",
      reason: "not_found",
    });
  });
});

describe("relógio do servidor na memória", () => {
  it("sem início registado no servidor, vale o tempo do browser (o formulário antes do jogo não conta)", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const ref = { participationId: started.participationId, token };
    // Participação iniciada há 5 minutos; o pedido de início do jogo perdeu-se.
    await prisma.participation.update({
      where: { id: ref.participationId },
      data: { startedAt: new Date(Date.now() - 5 * 60_000) },
    });

    const response = await submitMemoryResultAction({ ref, attempts: 2, pairsFound: 2, timeSeconds: 20 });

    expect(response).toMatchObject({ status: "revealed", result: { completed: true } });
    const result = await prisma.memoryResult.findUniqueOrThrow({ where: { participationId: ref.participationId } });
    expect(result.timeSeconds).toBe(20);
  });

  it("recarregar não repõe o tempo: o limite de tempo conta desde que o jogo abriu", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: null });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const ref = { participationId: started.participationId, token };

    expect(await beginGameAction(ref)).toEqual({ ok: true });
    // Um segundo início (F5) não reescreve o relógio.
    const session = await prisma.gameSession.findUniqueOrThrow({ where: { participationId: ref.participationId } });
    await prisma.gameSession.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect(await beginGameAction(ref)).toEqual({ ok: true });

    // O browser diz 20 s; passaram 5 minutos num jogo com 60 s de limite.
    const response = await submitMemoryResultAction({ ref, attempts: 2, pairsFound: 2, timeSeconds: 20 });
    expect(response.status).toBe("revealed");
    if (response.status === "revealed") expect(response.result.completed).toBe(false);
    const result = await prisma.memoryResult.findUniqueOrThrow({ where: { participationId: ref.participationId } });
    expect(result.timeSeconds).toBeGreaterThan(250);
  });
});

describe("formulário vazio, idade mínima e posição fixada", () => {
  it("um formulário sem campos nem consentimentos não entra no fluxo nem grava uma lead vazia", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_GAME", fields: [] });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    expect(started.leadForm).toBeNull();

    const ref = { participationId: started.participationId, token };
    // Sem formulário, o jogo abre sem lead.
    expect(await beginGameAction(ref)).toEqual({ ok: true });
    expect(await submitLeadFormAction({ ref, values: {}, consents: {} })).toEqual({ ok: true });
    const participation = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(participation.leadFormResponse).toBeNull();
    expect(participation.leadFormPosition).toBe("NONE");
  });

  it("com idade mínima e sem data de nascimento no formulário, não se joga (falha fechado)", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_GAME", minAge: 18 });
    // O rate limit vem antes: um pedido limitado não grava um bloqueio.
    rateLimit.allowed = false;
    expect(await fixture.start()).toEqual({ ok: false, reason: "rate_limited" });
    rateLimit.allowed = true;
    expect(await prisma.analyticsEvent.count({ where: { campaignId: fixture.campaignId, type: "PARTICIPATION_BLOCKED" } })).toBe(0);

    expect(await fixture.start()).toEqual({ ok: false, reason: "not_active" });
    const blocked = await prisma.analyticsEvent.findFirstOrThrow({
      where: { campaignId: fixture.campaignId, type: "PARTICIPATION_BLOCKED" },
    });
    expect(blocked).toMatchObject({ isTest: false, metadata: { reason: "age_unverifiable" } });

    const withBirthDate = await createFixture({
      position: "BEFORE_GAME",
      minAge: 18,
      fields: [{ type: "BIRTH_DATE", internalKey: "nascimento", required: true }],
    });
    expect((await withBirthDate.start()).ok).toBe(true);
  });

  it("mudar a posição a meio não muda o fluxo de quem já começou", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "AFTER_GAME" });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const ref = { participationId: started.participationId, token };

    await prisma.leadForm.update({ where: { id: fixture.leadFormId }, data: { position: "BEFORE_GAME" } });
    // Fixada "Depois do jogo": joga sem o formulário à frente.
    expect(await beginGameAction(ref)).toEqual({ ok: true });

    // Quem começa agora já apanha "Antes do jogo".
    const next = await fixture.start();
    expect(next.ok && next.leadForm?.position).toBe("BEFORE_GAME");
  });

  it("desligar o formulário liberta quem já tinha começado", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_GAME" });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const ref = { participationId: started.participationId, token };
    expect(await beginGameAction(ref)).toEqual({ ok: false });

    await prisma.leadForm.update({ where: { id: fixture.leadFormId }, data: { position: "NONE" } });
    expect(await beginGameAction(ref)).toEqual({ ok: true });
  });
});

describe("consentimentos", () => {
  it("cada registo guarda a origem: a página pública da campanha (§11)", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({ position: "BEFORE_GAME", consents: true });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    const consentId = started.leadForm?.consents[0]?.id ?? "";

    const ref = { participationId: started.participationId, token };
    expect(
      await submitLeadFormAction({ ref, values: { email: "ana@example.pt" }, consents: { [consentId]: true } }),
    ).toEqual({ ok: true });

    const { slug } = await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } });
    const records = await prisma.consentRecord.findMany({ where: { participationId: ref.participationId } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "GRANTED", source: `play:${slug}` });
  });
});

describe("telefone", () => {
  it("recusa telefones que não são números e deteta duplicados escritos de outra forma", async () => {
    const fixture = await createFixture({
      position: "BEFORE_GAME",
      fields: [{ type: "PHONE", internalKey: "tel", required: true }],
      dedupStrategies: ["PHONE"],
    });

    visitor.cookieId = randomUUID();
    const token = randomUUID();
    const first = await fixture.start(token);
    if (!first.ok) throw new Error("start");
    const ref = { participationId: first.participationId, token };
    expect(await submitLeadFormAction({ ref, values: { tel: "abc" }, consents: {} })).toEqual({ ok: false, reason: "phone" });
    expect(await submitLeadFormAction({ ref, values: { tel: "912 345 678" }, consents: {} })).toEqual({ ok: true });
    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.phone).toBe("912345678");
    // A resposta fica como foi escrita.
    expect(saved.leadFormResponse).toEqual({ tel: "912 345 678" });

    // Outro browser, o mesmo número com hífenes: duplicado.
    visitor.cookieId = randomUUID();
    const token2 = randomUUID();
    const second = await fixture.start(token2);
    if (!second.ok) throw new Error("start");
    expect(
      await submitLeadFormAction({
        ref: { participationId: second.participationId, token: token2 },
        values: { tel: "912-345-678" },
        consents: {},
      }),
    ).toEqual({ ok: false, reason: "duplicate" });
  });
});

describe("campos ocultos", () => {
  it("não vão para o browser; levam o valor predefinido e ignoram o que o browser mandar", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({
      position: "BEFORE_GAME",
      fields: [
        { type: "EMAIL", internalKey: "email", required: true },
        { type: "HIDDEN", internalKey: "origem", required: true, defaultValue: "newsletter-outubro" },
      ],
    });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    expect(started.leadForm?.fields.map((field) => field.internalKey)).toEqual(["email"]);

    const ref = { participationId: started.participationId, token };
    // Obrigatório mas oculto: o participante não o preenche e o envio passa.
    expect(
      await submitLeadFormAction({ ref, values: { email: "ana@example.pt", origem: "adulterado" }, consents: {} }),
    ).toEqual({ ok: true });
    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: ref.participationId } });
    expect(saved.leadFormResponse).toEqual({ email: "ana@example.pt", origem: "newsletter-outubro" });
  });

  it("um formulário só com campos ocultos não se mostra", async () => {
    visitor.cookieId = randomUUID();
    const fixture = await createFixture({
      position: "BEFORE_GAME",
      fields: [{ type: "HIDDEN", internalKey: "origem", defaultValue: "x" }],
    });
    const token = randomUUID();
    const started = await fixture.start(token);
    if (!started.ok) throw new Error("start");
    // Sem nada para o participante preencher, o jogo começa logo.
    expect(await beginGameAction({ participationId: started.participationId, token })).toEqual({ ok: true });
  });
});
