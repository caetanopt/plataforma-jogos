import { describe, expect, it } from "vitest";
import { CLOCK_GRACE_SECONDS, effectiveGameSeconds } from "@/features/play/game-clock";
import { visitorCookieOptions } from "@/features/play/cookie";
import {
  isPrizeAwardable,
  isSegmentEligible,
  NO_COUNTERS,
  pickByRoll,
  startOfDayInTimeZone,
  type PrizeForEligibility,
  type SegmentForEligibility,
} from "@/features/prizes/eligibility";

describe("relógio do servidor", () => {
  const startedAt = new Date("2026-09-30T10:00:00Z");

  it("sem início no servidor, usa o tempo do browser", () => {
    expect(effectiveGameSeconds({ clientSeconds: 42.7, startedAt: null, now: new Date() })).toBe(42);
  });

  it("um browser que diz menos do que passou fica com o tempo do servidor (menos a margem)", () => {
    const now = new Date(startedAt.getTime() + 300_000);
    expect(effectiveGameSeconds({ clientSeconds: 5, startedAt, now })).toBe(300 - CLOCK_GRACE_SECONDS);
  });

  it("um jogador honesto não é penalizado pela latência nem pela pré-visualização", () => {
    const now = new Date(startedAt.getTime() + 38_000);
    // 30 s de jogo, 5 s de pré-visualização das cartas, 3 s de rede.
    expect(effectiveGameSeconds({ clientSeconds: 30, startedAt, now, extraGraceSeconds: 5 })).toBe(30);
  });

  it("nunca passa o limite aceite", () => {
    const now = new Date(startedAt.getTime() + 3 * 86_400_000);
    expect(effectiveGameSeconds({ clientSeconds: 1, startedAt, now })).toBe(86_400);
  });
});

describe("cookie do visitante", () => {
  it("em https é particionado e SameSite=None (funciona num iframe de outro domínio)", () => {
    expect(visitorCookieOptions("https://jogos.caetano.pt", null, "production")).toMatchObject({
      sameSite: "none",
      secure: true,
      partitioned: true,
      httpOnly: true,
    });
  });

  it("localhost conta como contexto seguro", () => {
    expect(visitorCookieOptions("http://localhost:3000", null, "development").secure).toBe(true);
  });

  it("em http numa rede local fica Lax sem Secure (o browser recusaria o cookie)", () => {
    expect(visitorCookieOptions("http://192.168.1.20:3000", null, "development")).toMatchObject({
      sameSite: "lax",
      secure: false,
      partitioned: false,
    });
  });

  it("sem Origin, segue o proxy e depois o ambiente", () => {
    expect(visitorCookieOptions(null, "https", "development").secure).toBe(true);
    expect(visitorCookieOptions(null, "http", "production").secure).toBe(false);
    expect(visitorCookieOptions(null, null, "production").secure).toBe(true);
  });
});

describe("elegibilidade dos prémios", () => {
  const now = new Date("2026-07-20T12:00:00Z");
  const prize: PrizeForEligibility = {
    id: "p1",
    campaignId: "c1",
    isActive: true,
    startAt: null,
    endAt: null,
    totalQuantity: 10,
    awardedQuantity: 0,
    dailyLimit: null,
  };

  it("estado, período, stock com reservas e limite diário", () => {
    expect(isPrizeAwardable(prize, "c1", now, NO_COUNTERS)).toBe(true);
    expect(isPrizeAwardable({ ...prize, isActive: false }, "c1", now, NO_COUNTERS)).toBe(false);
    expect(isPrizeAwardable({ ...prize, startAt: new Date(now.getTime() + 1) }, "c1", now, NO_COUNTERS)).toBe(false);
    expect(isPrizeAwardable({ ...prize, endAt: new Date(now.getTime() - 1) }, "c1", now, NO_COUNTERS)).toBe(false);
    // Extremos inclusivos, como o período do segmento.
    expect(isPrizeAwardable({ ...prize, startAt: now, endAt: now }, "c1", now, NO_COUNTERS)).toBe(true);
    expect(isPrizeAwardable({ ...prize, awardedQuantity: 7 }, "c1", now, { reservedActive: 3, awardedToday: 0 })).toBe(false);
    expect(isPrizeAwardable({ ...prize, awardedQuantity: 7 }, "c1", now, { reservedActive: 2, awardedToday: 0 })).toBe(true);
    expect(isPrizeAwardable({ ...prize, dailyLimit: 2 }, "c1", now, { reservedActive: 0, awardedToday: 2 })).toBe(false);
    expect(isPrizeAwardable(prize, "outra-campanha", now, NO_COUNTERS)).toBe(false);
  });

  it("um segmento vencedor com o prémio indisponível sai do sorteio; o de recurso fica", () => {
    const win: SegmentForEligibility = {
      id: "s1",
      weight: 10,
      isActive: true,
      outcome: "WIN",
      periodStart: null,
      periodEnd: null,
      totalQuantity: null,
      remainingQuantity: null,
      prize: { ...prize, isActive: false },
    };
    const noWin: SegmentForEligibility = { ...win, id: "s2", outcome: "NO_WIN", prize: null };
    expect(isSegmentEligible(win, "c1", now, new Map())).toBe(false);
    expect(isSegmentEligible(noWin, "c1", now, new Map())).toBe(true);
  });

  it("a distribuição é proporcional aos pesos dos segmentos elegíveis", () => {
    const segments = [
      { id: "b", weight: 30 },
      { id: "c", weight: 60 },
    ];
    const counts = new Map<string, number>();
    for (let roll = 0; roll < 90; roll += 1) {
      const chosen = pickByRoll(segments, roll);
      counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    }
    // Sem o segmento A (10), B fica com 1/3 e C com 2/3.
    expect(counts.get("b")).toBe(30);
    expect(counts.get("c")).toBe(60);
  });
});

describe("início do dia no fuso da campanha", () => {
  it("em Lisboa, no verão, o dia começa às 23h UTC do dia anterior", () => {
    expect(startOfDayInTimeZone(new Date("2026-07-20T12:00:00Z"), "Europe/Lisbon").toISOString()).toBe(
      "2026-07-19T23:00:00.000Z",
    );
    // Logo depois da meia-noite local ainda é o mesmo dia local.
    expect(startOfDayInTimeZone(new Date("2026-07-19T23:30:00Z"), "Europe/Lisbon").toISOString()).toBe(
      "2026-07-19T23:00:00.000Z",
    );
  });

  it("no inverno coincide com UTC", () => {
    expect(startOfDayInTimeZone(new Date("2026-01-10T08:00:00Z"), "Europe/Lisbon").toISOString()).toBe(
      "2026-01-10T00:00:00.000Z",
    );
  });
});
