import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { LeadFormPosition } from "@/generated/prisma/client";
import type { ParticipationRef } from "@/features/play/types";

/**
 * Elegibilidade e reserva de prémios da roda (secção 13): o estado, o
 * período e o limite diário do prémio contam para o sorteio, e com o
 * formulário depois do jogo o prémio fica reservado até a lead ser aceite.
 *
 * As server actions correm contra a base de dados; só se substitui o que
 * depende de um pedido HTTP.
 */

vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => null }));

const { spinWheelAction, submitLeadFormAction } = await import("@/features/play/actions");
const { EXPIRED_RELEASE_BATCH } = await import("@/features/prizes/reservation");
const { getCampaignStats } = await import("@/features/analytics/campaign-stats");
const { drawAndAwardPrize, ParticipationAnonymizedError } = await import("@/features/wheel-game/draw");
const { anonymizeParticipationsByIds } = await import("@/features/privacy/anonymize");

interface Options {
  position: LeadFormPosition | null;
  prize?: { totalQuantity?: number | null; isActive?: boolean; startAt?: Date; endAt?: Date; dailyLimit?: number };
  codes?: number;
  segmentQuantity?: number;
  fallback?: boolean;
}

const cleanups: Array<() => Promise<void>> = [];

async function createFixture(options: Options) {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({ data: { name: `Reserva ${suffix}`, slug: `reserva-${suffix}` } });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `reserva-${suffix}@example.com`, passwordHash: "x" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Reserva", slug: `reserva-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "WHEEL",
      internalName: `Reserva ${suffix}`,
      ownerId: user.id,
      slug: `reserva-${suffix}`,
      status: "PUBLISHED",
      timezone: "Europe/Lisbon",
      dedupStrategies: ["EMAIL"],
      participationLimitType: "ONE_TOTAL",
    },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });

  let consentId = "";
  let leadFormId = "";
  if (options.position) {
    const form = await prisma.leadForm.create({
      data: {
        campaignId: campaign.id,
        position: options.position,
        honeypotEnabled: true,
        fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
        consentDefinitions: { create: [{ text: "Aceito o regulamento", required: true, order: 0 }] },
      },
      include: { consentDefinitions: true },
    });
    consentId = form.consentDefinitions[0].id;
    leadFormId = form.id;
  }

  const prize = await prisma.prize.create({
    data: {
      campaignId: campaign.id,
      internalName: "Voucher",
      publicName: "Voucher 10€",
      totalQuantity: options.prize?.totalQuantity === undefined ? 10 : options.prize.totalQuantity,
      isActive: options.prize?.isActive ?? true,
      startAt: options.prize?.startAt,
      endAt: options.prize?.endAt,
      dailyLimit: options.prize?.dailyLimit,
    },
  });
  for (let i = 0; i < (options.codes ?? 1); i += 1) {
    await prisma.prizeCode.create({ data: { prizeId: prize.id, code: `COD-${suffix}-${i}` } });
  }
  const wheelConfig = await prisma.wheelConfig.create({
    data: {
      campaignId: campaign.id,
      segments: {
        create: [
          {
            order: 0,
            name: "Ganhou",
            colorHex: "#00AEEF",
            outcome: "WIN",
            prizeId: prize.id,
            weight: 1000,
            totalQuantity: options.segmentQuantity ?? null,
            remainingQuantity: options.segmentQuantity ?? null,
          },
          ...(options.fallback
            ? [{ order: 1, name: "Não foi desta vez", colorHex: "#9CAEB8", outcome: "NO_WIN" as const, weight: 1 }]
            : []),
        ],
      },
    },
    include: { segments: true },
  });
  const winSegmentId = wheelConfig.segments.find((s) => s.outcome === "WIN")!.id;

  async function participate(isTest = false): Promise<ParticipationRef> {
    const participation = await prisma.participation.create({
      data: { campaignId: campaign.id, campaignVersionId: version.id, idempotencyKey: randomUUID(), isTest },
    });
    return { participationId: participation.id, token: participation.idempotencyKey };
  }

  function lead(ref: ParticipationRef, email: string, extra: { honeypot?: string } = {}) {
    return submitLeadFormAction({ ref, values: { email }, consents: { [consentId]: true }, ...extra });
  }

  cleanups.push(async () => {
    await prisma.analyticsEvent.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.prizeAward.deleteMany({ where: { participation: { campaignId: campaign.id } } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  return {
    organizationId: organization.id,
    campaignId: campaign.id,
    prizeId: prize.id,
    winSegmentId,
    leadFormId,
    participate,
    lead,
  };
}

const award = (participationId: string) =>
  prisma.prizeAward.findUniqueOrThrow({ where: { participationId }, include: { prizeCode: true } });
const prizeRow = (id: string) => prisma.prize.findUniqueOrThrow({ where: { id } });

function revealed<T>(response: { status: string; result?: T }): T {
  expect(response.status).toBe("revealed");
  return (response as { result: T }).result;
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("reserva do prémio até à lead", () => {
  it("'Depois do jogo': o prémio fica reservado sem código e é atribuído quando a lead é aceite", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME" });
    const ref = await fixture.participate();

    const spin = revealed(await spinWheelAction(ref));
    // O prémio aparece, mas o código (resgatável) e as instruções não.
    expect(spin.prize).toEqual({ publicName: "Voucher 10€", instructions: null, code: null });
    expect(spin.prizePending).toBe(true);

    const reserved = await award(ref.participationId);
    expect(reserved.status).toBe("RESERVED");
    expect(reserved.prizeCode?.status).toBe("RESERVED");
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(0);

    expect(await fixture.lead(ref, "ana@example.pt")).toEqual({ ok: true });

    const confirmed = await award(ref.participationId);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.prizeCode?.status).toBe("ASSIGNED");
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(1);

    const final = revealed(await spinWheelAction(ref));
    expect(final.prize?.code).toBe(confirmed.prizeCode?.code);
    expect(final.prizePending).toBe(false);

    const events = await prisma.analyticsEvent.count({ where: { campaignId: fixture.campaignId, type: "PRIZE_AWARDED" } });
    expect(events).toBe(1);
  });

  it("uma lead recusada por duplicado devolve a unidade, o código e o stock do segmento", async () => {
    const fixture = await createFixture({ position: "BEFORE_PRIZE", segmentQuantity: 5 });
    const first = await fixture.participate();
    revealed(await spinWheelAction(first));
    expect(await fixture.lead(first, "ana@example.pt")).toEqual({ ok: true });

    const second = await fixture.participate();
    revealed(await spinWheelAction(second));
    const segmentDuring = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: fixture.winSegmentId } });
    expect(segmentDuring.remainingQuantity).toBe(3);

    // A mesma pessoa, com o mesmo e-mail: recusada.
    const codeId = (await award(second.participationId)).prizeCodeId;
    expect(await fixture.lead(second, "ANA@example.pt ")).toEqual({ ok: false, reason: "duplicate" });

    const released = await award(second.participationId);
    expect(released.status).toBe("RELEASED");
    expect(released.releaseReason).toBe("DUPLICATE");
    expect(released.prizeCodeId).toBeNull();
    if (codeId) {
      expect((await prisma.prizeCode.findUniqueOrThrow({ where: { id: codeId } })).status).toBe("AVAILABLE");
    }
    const segmentAfter = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: fixture.winSegmentId } });
    expect(segmentAfter.remainingQuantity).toBe(4);
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(1);
  });

  it("uma reserva em curso conta para o stock: com 1 unidade, a segunda pessoa não ganha", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", prize: { totalQuantity: 1 }, fallback: true });
    const first = await fixture.participate();
    expect(revealed(await spinWheelAction(first)).outcome).toBe("WIN");

    const second = await fixture.participate();
    expect(revealed(await spinWheelAction(second)).outcome).toBe("NO_WIN");
  });

  it("uma reserva expirada volta ao stock no sorteio seguinte e, com stock, é reposta quando a lead chega", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", prize: { totalQuantity: 1 }, codes: 1, fallback: true });
    const late = await fixture.participate();
    revealed(await spinWheelAction(late));
    await prisma.prizeAward.update({
      where: { participationId: late.participationId },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });

    // O sorteio seguinte limpa a reserva expirada e pode ganhar o prémio.
    const other = await fixture.participate();
    expect(revealed(await spinWheelAction(other)).outcome).toBe("WIN");
    const expired = await award(late.participationId);
    expect(expired.status).toBe("RELEASED");
    expect(expired.releaseReason).toBe("EXPIRED");

    // Sem stock (a outra pessoa tem-no reservado), a lead tardia fica sem prémio.
    expect(await fixture.lead(late, "tarde@example.pt")).toEqual({ ok: true });
    expect((await award(late.participationId)).status).toBe("RELEASED");
    expect(revealed(await spinWheelAction(late)).prizeUnavailable).toBe(true);
  });

  it("com stock, uma reserva expirada é reposta com um código novo", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", codes: 2 });
    const ref = await fixture.participate();
    revealed(await spinWheelAction(ref));
    await prisma.prizeAward.update({
      where: { participationId: ref.participationId },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });

    expect(await fixture.lead(ref, "ana@example.pt")).toEqual({ ok: true });
    const settled = await award(ref.participationId);
    expect(settled.status).toBe("CONFIRMED");
    expect(settled.prizeCode?.status).toBe("ASSIGNED");
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(1);
  });

  it("o honeypot liberta a reserva (bot)", async () => {
    const fixture = await createFixture({ position: "BEFORE_PRIZE" });
    const ref = await fixture.participate();
    revealed(await spinWheelAction(ref));

    expect(await fixture.lead(ref, "bot@example.pt", { honeypot: "http://spam" })).toEqual({ ok: true });
    const released = await award(ref.participationId);
    expect(released.status).toBe("RELEASED");
    expect(released.releaseReason).toBe("BOT");
  });

  it("desligar o formulário depois do sorteio confirma a reserva na revelação seguinte", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME" });
    const ref = await fixture.participate();
    revealed(await spinWheelAction(ref));

    await prisma.leadForm.update({ where: { id: fixture.leadFormId }, data: { position: "NONE" } });
    const result = revealed(await spinWheelAction(ref));
    expect(result.prize?.code).toMatch(/^COD-/);
    expect((await award(ref.participationId)).status).toBe("CONFIRMED");
  });

  it("sem formulário, o prémio é atribuído no sorteio (como antes)", async () => {
    const fixture = await createFixture({ position: null });
    const ref = await fixture.participate();
    const result = revealed(await spinWheelAction(ref));
    expect(result.prize?.code).toMatch(/^COD-/);
    expect((await award(ref.participationId)).status).toBe("CONFIRMED");
  });

  it("em modo de teste nada é reservado nem atribuído", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME" });
    const ref = await fixture.participate(true);
    revealed(await spinWheelAction(ref));
    expect(await prisma.prizeAward.count({ where: { participationId: ref.participationId } })).toBe(0);
  });
});

describe("libertação de reservas expiradas", () => {
  /** Reservas expiradas já gravadas, sem passar pelo sorteio (a mais antiga primeiro). */
  async function expiredReservations(
    fixture: Awaited<ReturnType<typeof createFixture>>,
    count: number,
    expiredMsAgo: number,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const ref = await fixture.participate();
      const created = await prisma.prizeAward.create({
        data: {
          participationId: ref.participationId,
          prizeId: fixture.prizeId,
          status: "RESERVED",
          reservationExpiresAt: new Date(Date.now() - expiredMsAgo + i * 1000),
        },
      });
      ids.push(created.id);
    }
    return ids;
  }

  it("a unidade devolvida nunca passa o total do segmento, mesmo que o limite tenha mudado depois do sorteio", async () => {
    // Segmento sem limite no sorteio: a reserva não tirou nenhuma unidade.
    const fixture = await createFixture({ position: "AFTER_GAME" });
    const ref = await fixture.participate();
    revealed(await spinWheelAction(ref));
    await prisma.wheelSegment.update({
      where: { id: fixture.winSegmentId },
      data: { totalQuantity: 1, remainingQuantity: 1 },
    });

    expect(await fixture.lead(ref, "bot@example.pt", { honeypot: "http://spam" })).toEqual({ ok: true });

    expect((await award(ref.participationId)).status).toBe("RELEASED");
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: fixture.winSegmentId } });
    expect(segment.remainingQuantity).toBe(1);
  });

  it("cada sorteio liberta no máximo um lote, as mais antigas primeiro", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", prize: { totalQuantity: null }, codes: 0 });
    const ids = await expiredReservations(fixture, EXPIRED_RELEASE_BATCH + 3, 3_600_000);

    revealed(await spinWheelAction(await fixture.participate()));

    const released = await prisma.prizeAward.findMany({ where: { id: { in: ids }, status: "RELEASED" } });
    expect(released.map((row) => row.id).sort()).toEqual(ids.slice(0, EXPIRED_RELEASE_BATCH).sort());
    expect(released.every((row) => row.releaseReason === "EXPIRED")).toBe(true);

    // O sorteio seguinte continua o trabalho.
    revealed(await spinWheelAction(await fixture.participate()));
    expect(await prisma.prizeAward.count({ where: { id: { in: ids }, status: "RESERVED" } })).toBe(0);
  });

  it("sem códigos livres, liberta as reservas expiradas do prémio antes de o atribuir sem código", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", prize: { totalQuantity: null }, codes: 1 });
    const holder = await fixture.participate();
    revealed(await spinWheelAction(holder));
    const held = await award(holder.participationId);
    expect(held.prizeCode?.status).toBe("RESERVED");
    await prisma.prizeAward.update({
      where: { id: held.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });
    // Um lote inteiro de reservas mais antigas, sem código: o lote do
    // sorteio não chega à que tem o código.
    await expiredReservations(fixture, EXPIRED_RELEASE_BATCH, 3_600_000);

    const next = await fixture.participate();
    revealed(await spinWheelAction(next));

    expect((await award(holder.participationId)).status).toBe("RELEASED");
    const taken = await award(next.participationId);
    expect(taken.prizeCodeId).toBe(held.prizeCodeId);
    expect(taken.prizeCode?.status).toBe("RESERVED");
  });

  it("as estatísticas contam como não reclamada uma reserva expirada ainda por libertar", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", codes: 2 });
    const expired = await fixture.participate();
    revealed(await spinWheelAction(expired));
    await prisma.prizeAward.update({
      where: { participationId: expired.participationId },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });

    const stats = await getCampaignStats(
      fixture.organizationId,
      { preset: "all", from: new Date(0), to: new Date(Date.now() + 60_000) },
      { campaignId: fixture.campaignId },
    );

    expect(stats.wheel).toMatchObject({ winners: 1, prizesAwarded: 0, prizesReserved: 0, prizesUnclaimed: 1 });
  });
});

describe("reserva sob concorrência", () => {
  it("com 1 unidade e 6 rotações em simultâneo, só uma fica com a reserva", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", prize: { totalQuantity: 1 }, fallback: true });
    const refs = await Promise.all(Array.from({ length: 6 }, () => fixture.participate()));

    const results = await Promise.all(refs.map((ref) => spinWheelAction(ref)));
    const winners = results.filter((r) => r.status === "revealed" && r.result.outcome === "WIN");
    expect(winners).toHaveLength(1);
    expect(await prisma.prizeAward.count({ where: { prizeId: fixture.prizeId, status: "RESERVED" } })).toBe(1);
  }, 30_000);

  it("a mesma lead enviada duas vezes em simultâneo confirma o prémio uma só vez", async () => {
    const fixture = await createFixture({ position: "AFTER_GAME", codes: 3 });
    const ref = await fixture.participate();
    revealed(await spinWheelAction(ref));

    const results = await Promise.all([fixture.lead(ref, "ana@example.pt"), fixture.lead(ref, "ana@example.pt")]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(1);
    expect(await prisma.prizeCode.count({ where: { prizeId: fixture.prizeId, status: "ASSIGNED" } })).toBe(1);
    const events = await prisma.analyticsEvent.count({ where: { campaignId: fixture.campaignId, type: "PRIZE_AWARDED" } });
    expect(events).toBe(1);
  }, 30_000);
});

describe("elegibilidade do prémio no sorteio", () => {
  it("um prémio inativo não sai: a roda cai no segmento de recurso", async () => {
    const fixture = await createFixture({ position: null, prize: { isActive: false }, fallback: true });
    const result = revealed(await spinWheelAction(await fixture.participate()));
    expect(result.outcome).toBe("NO_WIN");
  });

  it("um prémio fora do período não sai", async () => {
    const future = await createFixture({
      position: null,
      prize: { startAt: new Date(Date.now() + 86_400_000) },
      fallback: true,
    });
    expect(revealed(await spinWheelAction(await future.participate())).outcome).toBe("NO_WIN");

    const past = await createFixture({ position: null, prize: { endAt: new Date(Date.now() - 1000) }, fallback: true });
    expect(revealed(await spinWheelAction(await past.participate())).outcome).toBe("NO_WIN");
  });

  it("o limite diário retira o prémio do sorteio em vez de fazer falhar a rotação", async () => {
    const fixture = await createFixture({ position: null, prize: { dailyLimit: 1 }, codes: 2, fallback: true });
    expect(revealed(await spinWheelAction(await fixture.participate())).outcome).toBe("WIN");
    expect(revealed(await spinWheelAction(await fixture.participate())).outcome).toBe("NO_WIN");
  });

  it("sem nenhum segmento elegível, a resposta diz porquê em vez de lançar um erro", async () => {
    const fixture = await createFixture({ position: null, prize: { isActive: false } });
    expect(await spinWheelAction(await fixture.participate())).toEqual({ status: "blocked", reason: "no_segments" });
  });
});

describe("participação anonimizada a meio", () => {
  it("anonimizada depois da verificação do jogo: o sorteio não corre nem atribui prémio", async () => {
    const fixture = await createFixture({ position: null });
    const ref = await fixture.participate();
    await anonymizeParticipationsByIds(fixture.organizationId, [ref.participationId]);

    await expect(drawAndAwardPrize(ref.participationId, new Date())).rejects.toBeInstanceOf(ParticipationAnonymizedError);
    expect(await prisma.prizeAward.count({ where: { participationId: ref.participationId } })).toBe(0);
    expect((await prizeRow(fixture.prizeId)).awardedQuantity).toBe(0);
    // Pela ação pública: bloqueada, sem erro.
    expect(await spinWheelAction(ref)).toEqual({ status: "blocked", reason: "not_found" });
  });
});
