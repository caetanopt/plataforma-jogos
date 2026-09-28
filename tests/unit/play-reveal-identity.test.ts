import { describe, expect, it } from "vitest";
import { leadMissingBeforePlay, projectWheelOutcome, revealPolicy } from "@/features/play/reveal";
import { extractLeadIdentity, normalizeEmail } from "@/features/play/identity";

describe("revealPolicy", () => {
  it("retém o resultado inteiro antes do formulário na posição 'antes do resultado'", () => {
    expect(revealPolicy("BEFORE_RESULT", false)).toBe("withhold_result");
  });

  it("retém só o prémio na posição 'antes do prémio'", () => {
    expect(revealPolicy("BEFORE_PRIZE", false)).toBe("withhold_prize");
  });

  it("revela tudo depois do formulário, em qualquer posição", () => {
    for (const position of ["BEFORE_GAME", "AFTER_GAME", "BEFORE_RESULT", "BEFORE_PRIZE", "NONE"] as const) {
      expect(revealPolicy(position, true)).toBe("full");
    }
  });

  it("revela tudo sem formulário ou com formulário depois do jogo", () => {
    expect(revealPolicy(null, false)).toBe("full");
    expect(revealPolicy("NONE", false)).toBe("full");
    expect(revealPolicy("AFTER_GAME", false)).toBe("full");
  });
});

describe("leadMissingBeforePlay", () => {
  it("só bloqueia o jogo quando o formulário é antes do jogo e ainda não foi submetido", () => {
    expect(leadMissingBeforePlay("BEFORE_GAME", false)).toBe(true);
    expect(leadMissingBeforePlay("BEFORE_GAME", true)).toBe(false);
    expect(leadMissingBeforePlay("BEFORE_RESULT", false)).toBe(false);
    expect(leadMissingBeforePlay(null, false)).toBe(false);
  });
});

describe("projectWheelOutcome", () => {
  const won = {
    segmentId: "s1",
    segmentName: "Ganhou",
    outcome: "WIN" as const,
    message: "Parabéns",
    prize: { id: "prize-interno", publicName: "Voucher", instructions: "Mostre no balcão", code: "ABC-123" },
  };

  it("com o prémio retido, não envia nome, instruções nem código", () => {
    const projected = projectWheelOutcome(won, "withhold_prize");

    expect(projected.prize).toBeNull();
    expect(projected.prizePending).toBe(true);
    const json = JSON.stringify(projected);
    for (const secret of ["Voucher", "Mostre no balcão", "ABC-123", "prize-interno"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("revelado, nunca inclui o id interno do prémio", () => {
    const projected = projectWheelOutcome(won, "full");

    expect(projected.prize).toEqual({ publicName: "Voucher", instructions: "Mostre no balcão", code: "ABC-123" });
    expect(JSON.stringify(projected)).not.toContain("prize-interno");
    expect(projected.prizePending).toBe(false);
  });

  it("sem prémio não há nada pendente", () => {
    const lost = { ...won, outcome: "NO_WIN" as const, prize: null };
    expect(projectWheelOutcome(lost, "withhold_prize").prizePending).toBe(false);
  });
});

describe("extractLeadIdentity", () => {
  const fields = [
    { type: "PHONE", internalKey: "tel", order: 2 },
    { type: "EMAIL", internalKey: "email_secundario", order: 5 },
    { type: "EMAIL", internalKey: "email", order: 0 },
    { type: "FULL_NAME", internalKey: "nome", order: 1 },
  ];

  it("usa o primeiro campo de cada tipo pela ordem do formulário e normaliza o e-mail", () => {
    const identity = extractLeadIdentity(fields, {
      email: "  Ana.Silva@Example.PT ",
      email_secundario: "outro@example.pt",
      nome: " Ana Silva ",
      tel: "912 345 678",
    });

    expect(identity).toEqual({
      email: "ana.silva@example.pt",
      phone: "912 345 678",
      firstName: "Ana Silva",
      lastName: null,
    });
  });

  it("valores em branco ficam nulos", () => {
    expect(extractLeadIdentity(fields, { email: "   ", nome: "" })).toEqual({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
    });
  });

  it("normalizeEmail", () => {
    expect(normalizeEmail(" A@B.PT ")).toBe("a@b.pt");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});
