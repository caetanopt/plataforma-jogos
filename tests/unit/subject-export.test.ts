import { describe, expect, it } from "vitest";
import {
  exportEvent,
  exportMention,
  formAnswers,
  publicCampaignName,
  subjectRights,
  type SubjectExportCampaign,
} from "@/features/privacy/subject-export";
import { normalizePhone, phoneMatchForms, writtenPhoneForm } from "@/features/play/identity";
import { isSameOriginRequest } from "@/lib/security/same-origin";

const campaign: SubjectExportCampaign = {
  id: "c1",
  name: "Campanha",
  publicUrl: "https://app.example/play/campanha",
  type: "MEMORY",
  timezone: "Europe/Lisbon",
  privacyNotice: null,
  legalLinks: { privacyPolicyUrl: null, termsUrl: null, cookiesUrl: null },
  retention: { kind: "none" },
  fields: [
    { internalKey: "nome", label: "Nome", type: "FIRST_NAME" },
    { internalKey: "regulamento", label: "Aceito o regulamento", type: "TERMS_ACCEPTANCE" },
  ],
  questions: new Map(),
  profiles: new Map(),
};

describe("respostas ao formulário na exportação do titular", () => {
  it("sem formulário submetido não há respostas; um objeto vazio é uma lista vazia", () => {
    expect(formAnswers(null, campaign)).toBeNull();
    expect(formAnswers("texto", campaign)).toBeNull();
    expect(formAnswers(["a"], campaign)).toBeNull();
    expect(formAnswers({}, campaign)).toEqual([]);
  });

  it("pela ordem do formulário, com as caixas em Sim/Não e os campos que já não existem no fim", () => {
    expect(formAnswers({ extra: 3, regulamento: "true", nome: "Ana" }, campaign)).toEqual([
      { Campo: "Nome", Resposta: "Ana" },
      { Campo: "Aceito o regulamento", Resposta: "Sim" },
      { Campo: "extra", Resposta: "3" },
    ]);
  });

  it("um campo com o nome de uma propriedade do protótipo não inventa uma resposta", () => {
    const withPrototypeKeys: SubjectExportCampaign = {
      ...campaign,
      fields: [
        { internalKey: "constructor", label: "Construtor", type: "SHORT_TEXT" },
        { internalKey: "toString", label: "Texto", type: "SHORT_TEXT" },
      ],
    };
    // Antes, com `in`, saía { Campo: "Construtor", Resposta: undefined }.
    expect(formAnswers({}, withPrototypeKeys)).toEqual([]);
    expect(formAnswers({ constructor: "Sim" }, withPrototypeKeys)).toEqual([{ Campo: "Construtor", Resposta: "Sim" }]);
    const answers = formAnswers({ nome: "Ana" }, withPrototypeKeys) as Array<Record<string, unknown>>;
    for (const entry of answers) {
      for (const value of Object.values(entry)) expect(value).not.toBeUndefined();
    }
  });
});

describe("telefones equivalentes no pedido de um titular", () => {
  const PORTUGUESE = ["912345678", "912 345 678", "+351 912 345 678", "00351912345678", "(+351) 912-345-678", "00 351 912 345 678"];

  /** O que o SQL faz: a forma escrita de uma resposta contra as formas do pedido. */
  const sameNumber = (request: string, answer: string) =>
    phoneMatchForms(normalizePhone(request)!).written.includes(writtenPhoneForm(answer));

  it("um número português encontra-se com ou sem o indicativo, escrito de qualquer forma", () => {
    for (const request of PORTUGUESE) {
      for (const answer of PORTUGUESE) expect(sameNumber(request, answer), `${request} ~ ${answer}`).toBe(true);
    }
    expect(phoneMatchForms("912345678").normalized).toEqual(["912345678", "+351912345678"]);
    expect(phoneMatchForms("+351912345678").normalized).toEqual(["+351912345678", "912345678"]);
    expect(phoneMatchForms("+351912345678").written).toEqual(["+351912345678", "00351912345678", "912345678"]);
  });

  it("as colunas de identidade (normalizePhone) coincidem com as formas normalizadas", () => {
    for (const request of PORTUGUESE) {
      const forms = phoneMatchForms(normalizePhone(request)!).normalized;
      for (const stored of PORTUGUESE) expect(forms).toContain(normalizePhone(stored));
    }
  });

  it("outros números, outros países e números sem o mesmo indicativo ficam diferentes", () => {
    expect(sameNumber("912345678", "912345679")).toBe(false);
    // "+912345678" é um número da Índia (+91), não o português sem indicativo.
    expect(sameNumber("912345678", "+912345678")).toBe(false);
    // "00912345678" é o mesmo "+91…".
    expect(sameNumber("912345678", "00912345678")).toBe(false);
    expect(sameNumber("+44 7700 900123", "+44 7700 900123")).toBe(true);
    expect(sameNumber("+44 7700 900123", "0044 7700 900123")).toBe(true);
    // Sem adivinhar indicativos de outros países.
    expect(sameNumber("+44 7700 900123", "07700 900123")).toBe(false);
    expect(phoneMatchForms("+447700900123").normalized).toEqual(["+447700900123"]);
    // 9 dígitos a começar por 0 ou 1 não são um número português.
    expect(phoneMatchForms("012345678").normalized).toEqual(["012345678"]);
    expect(phoneMatchForms("+351012345678").normalized).toEqual(["+351012345678"]);
  });

  it("a forma escrita segue normalizePhone: o '+' só conta antes do primeiro dígito", () => {
    expect(writtenPhoneForm("+351 912 345 678")).toBe("+351912345678");
    expect(writtenPhoneForm("tel. 912 345 678")).toBe("912345678");
    expect(writtenPhoneForm("912 345 678 +")).toBe("912345678");
    expect(writtenPhoneForm("00351 912 345 678")).toBe("00351912345678");
  });
});

describe("conteúdo do ficheiro", () => {
  it("o nome público da campanha, como na página pública, nunca o interno", () => {
    expect(publicCampaignName({ publicTitle: "Verão", startTitle: "Jogue" })).toBe("Verão");
    expect(publicCampaignName({ publicTitle: "  ", startTitle: "Jogue" })).toBe("Jogue");
    expect(publicCampaignName({ publicTitle: null, startTitle: null })).toBe("Campanha");
  });

  it("os direitos do titular, com o contacto de privacidade e a CNPD", () => {
    const withContact = subjectRights({ name: "Caetano", privacyContactEmail: "privacidade@example.pt" }) as Record<string, string>;
    expect(Object.keys(withContact)).toEqual(
      expect.arrayContaining(["Acesso", "Retificação", "Apagamento", "Limitação do tratamento", "Oposição", "Portabilidade"]),
    );
    expect(withContact["Como exercer"]).toContain("privacidade@example.pt");
    expect(withContact.Reclamação).toContain("Comissão Nacional de Proteção de Dados");
    expect(withContact.Reclamação).toContain("www.cnpd.pt");

    const without = subjectRights({ name: "Caetano", privacyContactEmail: null }) as Record<string, string>;
    expect(without["Como exercer"]).toContain("Contacte Caetano");
    expect(without["Como exercer"]).not.toContain("null");
  });

  it("uma menção leva só o campo, com o nome do campo do formulário", () => {
    const createdAt = new Date("2026-09-01T10:00:00Z");
    expect(exportMention({ createdAt, key: "nome", value: "ana@example.pt" }, campaign)).toEqual({
      Campanha: "Campanha",
      "ID da campanha": "c1",
      Data: "2026-09-01T10:00:00.000Z",
      Campo: "Nome",
      Valor: "ana@example.pt",
    });
    expect(exportMention({ createdAt, key: "removido", value: "x" }, campaign)).toMatchObject({ Campo: "removido" });
  });

  it("um evento leva o tipo e a data; dos metadados, só um motivo conhecido", () => {
    const occurredAt = new Date("2026-09-01T10:00:00Z");
    expect(exportEvent({ type: "GAME_STARTED", occurredAt, metadata: null })).toEqual({
      Evento: "Jogo iniciado",
      Data: "2026-09-01T10:00:00.000Z",
    });
    expect(exportEvent({ type: "PARTICIPATION_BLOCKED", occurredAt, metadata: { reason: "limit" } })).toEqual({
      Evento: "Participação recusada",
      Data: "2026-09-01T10:00:00.000Z",
      Motivo: "Limite de participações atingido",
    });
    for (const metadata of [{ reason: "outro" }, { reason: "constructor" }, { ip: "203.0.113.7" }, "limit", [1]]) {
      expect(exportEvent({ type: "PARTICIPATION_BLOCKED", occurredAt, metadata })).not.toHaveProperty("Motivo");
    }
  });
});

describe("mesma origem", () => {
  const request = (headers: Record<string, string>) => new Request("http://interno:3000/x", { method: "POST", headers });

  it("compara o Origin com o host que o browser usou", () => {
    expect(isSameOriginRequest(request({ host: "app.example", origin: "https://app.example" }))).toBe(true);
    expect(
      isSameOriginRequest(request({ host: "interno:3000", "x-forwarded-host": "app.example", origin: "https://app.example" })),
    ).toBe(true);
    expect(isSameOriginRequest(request({ host: "app.example", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginRequest(request({ host: "app.example", origin: "null" }))).toBe(false);
  });

  it("sem Origin, só quando o pedido o permite", () => {
    expect(isSameOriginRequest(request({ host: "app.example" }))).toBe(false);
    expect(isSameOriginRequest(request({ host: "app.example" }), { allowMissingOrigin: true })).toBe(true);
  });
});
