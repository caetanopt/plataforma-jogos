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
    consentRecords: [],
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

  it("uma lead anonimizada sai sem identidade e com a data da anonimização", () => {
    const anonymizedAt = new Date("2026-10-01T03:17:00Z");
    const row = toLeadRow(participation({ firstName: null, email: null, anonymizedAt }), now);
    expect(row).toMatchObject({ name: "", email: "", anonymizedAt: "2026-10-01T03:17:00.000Z" });
    expect(leadsToCsv([row]).split("\n")[1]!.endsWith(",2026-10-01T03:17:00.000Z")).toBe(true);
    expect(toLeadRow(participation(), now).anonymizedAt).toBe("");
  });

  it("acrescenta as colunas novas no fim, sem mudar a posição das antigas", () => {
    const header = leadsToCsv([]).split("\n")[0];
    expect(header.endsWith(",Teste,Estado do prémio,Consentimento de marketing,Consentimentos,Anonimizada em")).toBe(true);
  });
});

describe("consentimentos na lista e na exportação", () => {
  const T0 = new Date("2026-09-30T09:00:00Z");
  function record(definitionId: string, status: "GRANTED" | "DECLINED" | "WITHDRAWN", isMarketing: boolean, extra = {}) {
    return {
      consentDefinitionId: definitionId,
      status,
      text: isMarketing ? "Aceito receber novidades por e-mail" : "Aceito o regulamento",
      version: 2,
      grantedAt: T0,
      consentDefinition: { isMarketing, order: 0 },
      ...extra,
    };
  }
  const withConsents = (records: unknown[]) =>
    toLeadRow(participation({ consentRecords: records as Participation["consentRecords"] }), now);

  it("estado do marketing: concedido, recusado, parcial ou sem consentimento", () => {
    expect(withConsents([record("r", "GRANTED", false)]).marketingConsent).toBe("");
    expect(withConsents([record("m", "GRANTED", true)]).marketingConsent).toBe("Concedido");
    expect(withConsents([record("m", "DECLINED", true)]).marketingConsent).toBe("Recusado");
    expect(
      withConsents([record("m1", "GRANTED", true), record("m2", "DECLINED", true)]).marketingConsent,
    ).toBe("Parcial");
  });

  it("conta o registo mais recente de cada consentimento (uma retirada depois de aceitar)", () => {
    const row = withConsents([
      record("m", "GRANTED", true),
      record("m", "WITHDRAWN", true, { grantedAt: new Date(T0.getTime() + 60_000) }),
    ]);
    expect(row.marketingConsent).toBe("Recusado");
    expect(row.consentStatusByDefinition).toEqual({ m: { status: "Retirado", version: 2 } });
  });

  it("o resumo leva o texto, a versão, o estado e a data", () => {
    const row = withConsents([record("r", "GRANTED", false), record("m", "DECLINED", true)]);
    expect(row.consents).toBe(
      "«Aceito o regulamento» (v2): Aceite em 2026-09-30T09:00:00.000Z | «Aceito receber novidades por e-mail» (v2): Recusado em 2026-09-30T09:00:00.000Z",
    );
  });

  it("numa campanha, uma coluna por consentimento; uma resposta a outra versão di-lo", () => {
    const row = withConsents([record("r", "GRANTED", false), record("m", "DECLINED", true)]);
    const csv = leadsToCsv(
      [row],
      [
        { definitionId: "r", text: "Aceito o regulamento", version: 2 },
        { definitionId: "m", text: "Aceito receber novidades por e-mail", version: 3 },
        { definitionId: "novo", text: "Consentimento acrescentado depois", version: 1 },
      ],
    );
    const [header, line] = csv.split("\n");
    expect(header.endsWith(
      ",Consentimentos,Anonimizada em,Consentimento: Aceito o regulamento (v2),Consentimento: Aceito receber novidades por e-mail (v3),Consentimento: Consentimento acrescentado depois (v1)",
    )).toBe(true);
    expect(line.endsWith(
      // O marketing foi recusado na v2; a coluna é a v3 (texto novo).
      ",Recusado,«Aceito o regulamento» (v2): Aceite em 2026-09-30T09:00:00.000Z | «Aceito receber novidades por e-mail» (v2): Recusado em 2026-09-30T09:00:00.000Z,,Aceite,Recusado (v2),",
    )).toBe(true);
  });
});
