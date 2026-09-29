import { describe, expect, it } from "vitest";
import { emptyToNull, readCheckbox, readMultiple, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { fail, ok, partialResult, zodFieldErrors } from "@/lib/forms/action-result";
import {
  dateTimeLocalField,
  httpUrlField,
  intField,
  optionalIntField,
  requiredTextField,
  textField,
} from "@/lib/validation/fields";
import { startScreenShape } from "@/lib/validation/campaign";
import { z } from "zod";

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("leitura do FormData", () => {
  it("distingue campo ausente de campo vazio", () => {
    const data = form([["title", ""]]);
    expect(readOptional(data, "title")).toBe("");
    expect(readOptional(data, "missing")).toBeUndefined();
  });

  it("checkbox com sentinela: marcada, desmarcada e ausente", () => {
    expect(readCheckbox(form([["a", ""], ["a", "on"]]), "a")).toBe(true);
    expect(readCheckbox(form([["a", ""]]), "a")).toBe(false);
    expect(readCheckbox(form([]), "a")).toBeUndefined();
  });

  it("grupo de checkboxes ignora a sentinela", () => {
    expect(readMultiple(form([["s", ""], ["s", "EMAIL"], ["s", "PHONE"]]), "s")).toEqual(["EMAIL", "PHONE"]);
    expect(readMultiple(form([["s", ""]]), "s")).toEqual([]);
    expect(readMultiple(form([]), "s")).toBeUndefined();
  });

  it("emptyToNull apaga com '' e mantém com undefined", () => {
    expect(emptyToNull("")).toBeNull();
    expect(emptyToNull(undefined)).toBeUndefined();
    expect(emptyToNull("x")).toBe("x");
  });
});

describe("campos dos schemas", () => {
  it("inteiro obrigatório: vazio é erro, não 0", () => {
    const columns = intField("Colunas", 2, 8);
    expect(columns.safeParse("").success).toBe(false);
    expect(columns.safeParse("").error?.issues[0]?.message).toBe("Colunas: obrigatório.");
    expect(columns.safeParse("abc").error?.issues[0]?.message).toBe("Colunas: tem de ser um número.");
    expect(columns.safeParse("9").error?.issues[0]?.message).toBe("Colunas: máximo 8.");
    expect(columns.safeParse(" 4 ").data).toBe(4);
  });

  it("inteiro opcional: vazio é null", () => {
    const limit = optionalIntField("Tempo limite", 0, 3600);
    expect(limit.safeParse("").data).toBeNull();
    expect(limit.safeParse("30").data).toBe(30);
    expect(limit.safeParse("-1").success).toBe(false);
    expect(limit.safeParse("1.5").error?.issues[0]?.message).toBe("Tempo limite: tem de ser um número inteiro.");
  });

  it("texto com o nome do campo na mensagem", () => {
    expect(textField("Regulamento", 5).safeParse("123456").error?.issues[0]?.message).toBe(
      "Regulamento: máximo 5 caracteres.",
    );
    expect(requiredTextField("Nome", 10).safeParse("   ").error?.issues[0]?.message).toBe("Nome: obrigatório.");
  });

  it("links só http(s)", () => {
    const url = httpUrlField("Link");
    expect(url.safeParse("").success).toBe(true);
    expect(url.safeParse("https://caetano.pt/x").success).toBe(true);
    expect(url.safeParse("javascript:alert(1)").success).toBe(false);
    expect(url.safeParse("data:text/html,<b>x</b>").success).toBe(false);
    expect(url.safeParse("caetano.pt").success).toBe(false);
  });

  it("datas: recusa os anos intermédios de quem escreve o ano", () => {
    const date = dateTimeLocalField("Início");
    expect(date.safeParse("").success).toBe(true);
    expect(date.safeParse("2026-10-01T10:00").success).toBe(true);
    expect(date.safeParse("0202-10-01T10:00").success).toBe(false);
    expect(date.safeParse("2026-10-01").success).toBe(false);
    expect(date.safeParse("2030-13-01T10:00").success).toBe(false);
    expect(date.safeParse("2030-04-31T10:00").success).toBe(false);
    expect(date.safeParse("2028-02-29T10:00").success).toBe(true);
    expect(date.safeParse("2030-01-01T24:00").success).toBe(false);
  });
});

describe("parsePartial", () => {
  it("grava os campos válidos e devolve os inválidos", () => {
    const parse = parsePartial(startScreenShape, {
      startTitle: "Olá",
      regulationText: "x".repeat(20001),
      countdownEnabled: true,
      startSubtitle: undefined,
    });
    expect(parse.data).toEqual({ startTitle: "Olá", countdownEnabled: true });
    expect(Object.keys(parse.fieldErrors)).toEqual(["regulationText"]);
    expect(parse.fieldErrors.regulationText).toBe("Regulamento: máximo 20000 caracteres.");
    expect("startSubtitle" in parse.data).toBe(false);
  });

  it("rejectField tira o campo dos dados e regista o erro", () => {
    const parse = parsePartial({ a: z.string(), b: z.string() }, { a: "1", b: "2" });
    rejectField(parse, "b", "B: inválido.");
    expect(parse.data).toEqual({ a: "1" });
    expect(parse.fieldErrors).toEqual({ b: "B: inválido." });
  });
});

describe("resultado das ações", () => {
  it("ok, fail e parcial", () => {
    expect(ok().status).toBe("success");
    expect(fail("x", { a: "b" })).toMatchObject({ status: "error", message: "x", fieldErrors: { a: "b" } });
    expect(partialResult({}, true).status).toBe("success");
    expect(partialResult({ a: "b" }, true)).toMatchObject({ message: "Algumas alterações não foram guardadas." });
    expect(partialResult({ a: "b" }, false)).toMatchObject({ message: "As alterações não foram guardadas." });
  });

  it("zodFieldErrors fica com a primeira mensagem de cada campo", () => {
    const schema = z.object({ a: z.string().min(2, "curto").regex(/^y/, "formato"), b: z.number() });
    const result = schema.safeParse({ a: "x", b: "y" });
    expect(result.success).toBe(false);
    if (!result.success) expect(zodFieldErrors(result.error)).toEqual({ a: "curto", b: expect.any(String) });
  });
});
