import { describe, expect, it, vi } from "vitest";
import { canRevealSecrets, planSuperAdminPassword } from "../../prisma/seed-superadmin";

const STRONG = "uma-password-forte";

function plan(overrides: Partial<Parameters<typeof planSuperAdminPassword>[0]> = {}) {
  return planSuperAdminPassword({
    userExists: false,
    providedPassword: undefined,
    resetRequested: false,
    canReveal: false,
    generatePassword: () => "gerada-no-seed",
    ...overrides,
  });
}

describe("planSuperAdminPassword", () => {
  it("em CI, sem password definida, recusa criar em vez de gerar uma para o log", () => {
    const generatePassword = vi.fn(() => "nunca-usada");
    const result = plan({ canReveal: false, generatePassword });

    expect(result.kind).toBe("error");
    expect(generatePassword).not.toHaveBeenCalled();
  });

  it("trata a string vazia como ausente (secret por definir no GitHub Actions)", () => {
    expect(plan({ providedPassword: "", canReveal: false }).kind).toBe("error");
  });

  it("num terminal local, gera a password e só aí a mostra", () => {
    expect(plan({ canReveal: true })).toEqual({
      kind: "create",
      password: "gerada-no-seed",
      reveal: true,
    });
  });

  it("nunca mostra uma password fornecida, mesmo num terminal local", () => {
    expect(plan({ providedPassword: STRONG, canReveal: true })).toEqual({
      kind: "create",
      password: STRONG,
      reveal: false,
    });
  });

  it("não toca num utilizador existente sem pedido explícito", () => {
    expect(plan({ userExists: true, providedPassword: STRONG })).toEqual({ kind: "keep" });
  });

  it("repõe a password de um utilizador existente quando pedido", () => {
    expect(plan({ userExists: true, providedPassword: STRONG, resetRequested: true })).toEqual({
      kind: "reset",
      password: STRONG,
    });
  });

  it("recusa a reposição sem password definida", () => {
    const generatePassword = vi.fn(() => "nunca-usada");
    const result = plan({ userExists: true, resetRequested: true, canReveal: true, generatePassword });

    expect(result.kind).toBe("error");
    expect(generatePassword).not.toHaveBeenCalled();
  });

  it("valida a política de password sem ecoar o valor recebido", () => {
    const result = plan({ providedPassword: "curta" });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).not.toContain("curta");
  });
});

describe("canRevealSecrets", () => {
  it("só num terminal interativo fora de CI", () => {
    expect(canRevealSecrets({}, true)).toBe(true);
    expect(canRevealSecrets({}, false)).toBe(false);
    expect(canRevealSecrets({}, undefined)).toBe(false);
  });

  it("deteta o GitHub Actions e o Vercel mesmo com TTY", () => {
    expect(canRevealSecrets({ GITHUB_ACTIONS: "true" }, true)).toBe(false);
    expect(canRevealSecrets({ CI: "true" }, true)).toBe(false);
    expect(canRevealSecrets({ CI: "1" }, true)).toBe(false);
  });

  it("aceita CI desligado explicitamente", () => {
    expect(canRevealSecrets({ CI: "false" }, true)).toBe(true);
    expect(canRevealSecrets({ CI: "0" }, true)).toBe(true);
    expect(canRevealSecrets({ CI: "" }, true)).toBe(true);
  });
});
