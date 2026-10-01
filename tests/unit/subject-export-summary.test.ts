import { describe, expect, it } from "vitest";
import { countSubjectExport, describeSubjectExport } from "@/features/privacy/subject-export-summary";

/** Um ficheiro com as chaves da exportação, pela ordem do contrato. */
function file(lists: { participations?: number; mentions?: number; legacy?: number }): string {
  const items = (count = 0) => Array.from({ length: count }, (_, index) => ({ n: index }));
  return JSON.stringify({
    "Sobre esta exportação": {},
    "Os seus direitos": {},
    Campanhas: [],
    Participações: items(lists.participations),
    "Menções noutras participações": items(lists.mentions),
    "Dados antigos de participante": items(lists.legacy),
  });
}

describe("contagens do ficheiro da exportação do titular", () => {
  it("conta as três listas do próprio ficheiro", () => {
    expect(countSubjectExport(file({ participations: 2, mentions: 1, legacy: 3 }))).toEqual({
      participations: 2,
      mentions: 1,
      legacy: 3,
    });
    expect(countSubjectExport(file({}))).toEqual({ participations: 0, mentions: 0, legacy: 0 });
  });

  it("um JSON cortado a meio, outro JSON ou um ficheiro sem participações não é o ficheiro", () => {
    expect(countSubjectExport(file({ participations: 1 }).slice(0, -10))).toBeNull();
    expect(countSubjectExport("")).toBeNull();
    expect(countSubjectExport("<!doctype html>")).toBeNull();
    expect(countSubjectExport("null")).toBeNull();
    expect(countSubjectExport("[]")).toBeNull();
    expect(countSubjectExport(JSON.stringify({ error: "A exportação falhou." }))).toBeNull();
    expect(countSubjectExport(JSON.stringify({ Participações: {} }))).toBeNull();
  });

  it("uma lista que falta conta como vazia", () => {
    expect(countSubjectExport(JSON.stringify({ Participações: [{}] }))).toEqual({
      participations: 1,
      mentions: 0,
      legacy: 0,
    });
  });
});

describe("mensagem depois do download", () => {
  it("diz o que o ficheiro leva, sem as listas vazias", () => {
    expect(describeSubjectExport({ participations: 2, mentions: 1, legacy: 1 })).toBe(
      "Ficheiro descarregado: 2 participações, 1 menção noutra participação e 1 registo antigo.",
    );
    expect(describeSubjectExport({ participations: 1, mentions: 0, legacy: 0 })).toBe(
      "Ficheiro descarregado: 1 participação.",
    );
    expect(describeSubjectExport({ participations: 0, mentions: 3, legacy: 2 })).toBe(
      "Ficheiro descarregado: 3 menções noutras participações e 2 registos antigos.",
    );
    expect(describeSubjectExport({ participations: 0, mentions: 0, legacy: 1 })).toBe(
      "Ficheiro descarregado: 1 registo antigo.",
    );
  });

  it("sem nada, diz que o ficheiro o explica ao titular", () => {
    expect(describeSubjectExport({ participations: 0, mentions: 0, legacy: 0 })).toBe(
      "Ficheiro descarregado: sem dados com este e-mail ou telefone (o ficheiro diz isso ao titular).",
    );
  });
});
