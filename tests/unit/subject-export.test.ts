import { describe, expect, it } from "vitest";
import { formAnswers, type SubjectExportCampaign } from "@/features/privacy/subject-export";
import { isSameOriginRequest } from "@/lib/security/same-origin";

const campaign: SubjectExportCampaign = {
  id: "c1",
  name: "Campanha",
  type: "MEMORY",
  timezone: "Europe/Lisbon",
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
