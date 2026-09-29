import { describe, expect, it } from "vitest";
import { leadsToCsv, toLeadRow } from "@/features/leads/format";

type Participation = Parameters<typeof toLeadRow>[0];

const now = new Date("2026-09-30T10:00:00Z");

function participation(overrides: Partial<Participation> = {}): Participation {
  return {
    id: "p1",
    createdAt: now,
    status: "COMPLETED",
    isTest: false,
    campaignId: "c1",
    campaign: { internalName: "Roda", type: "WHEEL" },
    firstName: "Ana",
    lastName: null,
    email: "ana@example.pt",
    phone: null,
    resultSummary: { outcome: "WIN" },
    prizeAward: null,
    ...overrides,
  } as Participation;
}

function award(status: "RESERVED" | "CONFIRMED" | "RELEASED", extra: Record<string, unknown> = {}) {
  return {
    status,
    reservationExpiresAt: null,
    releaseReason: null,
    prize: { publicName: "Voucher 10€" },
    prizeCode: { code: "ABC-123" },
    ...extra,
  } as unknown as Participation["prizeAward"];
}

describe("prémio na lista de leads", () => {
  it("atribuído: nome, código e estado", () => {
    const row = toLeadRow(participation({ prizeAward: award("CONFIRMED") }), now);
    expect(row).toMatchObject({ prize: "Voucher 10€", code: "ABC-123", prizeStatus: "Atribuído" });
  });

  it("reservado: nunca mostra o código", () => {
    const row = toLeadRow(
      participation({ prizeAward: award("RESERVED", { reservationExpiresAt: new Date(now.getTime() + 60_000) }) }),
      now,
    );
    expect(row).toMatchObject({ prize: "", code: "", prizeStatus: "Reservado (a aguardar a lead)" });
  });

  it("libertado: diz porquê e não exporta o código", () => {
    const row = toLeadRow(participation({ prizeAward: award("RELEASED", { releaseReason: "DUPLICATE" }) }), now);
    expect(row).toMatchObject({ code: "", prizeStatus: "Não atribuído (lead duplicada)" });
    expect(leadsToCsv([row])).not.toContain("ABC-123");
  });
});

describe("exportação CSV", () => {
  it("neutraliza fórmulas vindas de participantes", () => {
    const csv = leadsToCsv([
      toLeadRow(participation({ firstName: "=HYPERLINK(\"http://x\",\"clique\")", email: "@SUM(1+1)" }), now),
    ]);
    const line = csv.split("\n")[1];
    expect(line).toContain(`"'=HYPERLINK(""http://x"",""clique"")"`);
    expect(line).toContain("'@SUM(1+1)");
  });

  it("não estraga telefones com indicativo", () => {
    const csv = leadsToCsv([toLeadRow(participation({ phone: "+351912345678" }), now)]);
    expect(csv.split("\n")[1]).toContain(",+351912345678,");
  });

  it("acrescenta a coluna do estado do prémio no fim", () => {
    const header = leadsToCsv([]).split("\n")[0];
    expect(header.endsWith(",Teste,Estado do prémio")).toBe(true);
  });
});
