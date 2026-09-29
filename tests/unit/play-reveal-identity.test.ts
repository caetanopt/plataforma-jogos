import { describe, expect, it } from "vitest";
import {
  effectiveLeadFormPosition,
  holdsPrizeUntilLead,
  leadMissingBeforePlay,
  participationLeadFormPosition,
  projectWheelOutcome,
  revealPolicy,
} from "@/features/play/reveal";
import { extractLeadIdentity, isPlausiblePhone, normalizeEmail, normalizePhone } from "@/features/play/identity";

describe("revealPolicy", () => {
  it("retém o resultado inteiro antes do formulário na posição 'antes do resultado'", () => {
    expect(revealPolicy("BEFORE_RESULT", false, "WHEEL")).toBe("withhold_result");
    expect(revealPolicy("BEFORE_RESULT", false, "QUIZ")).toBe("withhold_result");
  });

  it("retém só o prémio na posição 'antes do prémio'", () => {
    expect(revealPolicy("BEFORE_PRIZE", false, "WHEEL")).toBe("withhold_prize");
  });

  it("na roda com o formulário depois do jogo, retém o código até à lead", () => {
    expect(revealPolicy("AFTER_GAME", false, "WHEEL")).toBe("withhold_code");
    // Memória e quiz não têm prémios.
    expect(revealPolicy("AFTER_GAME", false, "MEMORY")).toBe("full");
    expect(revealPolicy("AFTER_GAME", false, "QUIZ")).toBe("full");
  });

  it("revela tudo depois do formulário, em qualquer posição", () => {
    for (const position of ["BEFORE_GAME", "AFTER_GAME", "BEFORE_RESULT", "BEFORE_PRIZE", "NONE"] as const) {
      expect(revealPolicy(position, true, "WHEEL")).toBe("full");
    }
  });

  it("revela tudo sem formulário", () => {
    expect(revealPolicy(null, false, "WHEEL")).toBe("full");
    expect(revealPolicy("NONE", false, "WHEEL")).toBe("full");
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

describe("posição efetiva do formulário", () => {
  const form = (position: "BEFORE_GAME" | "AFTER_GAME" | "NONE", fieldCount = 1, consentCount = 0) => ({
    position,
    fieldCount,
    consentCount,
  });

  it("um formulário sem campos nem consentimentos vale 'Sem formulário'", () => {
    expect(effectiveLeadFormPosition(form("BEFORE_GAME", 0, 0))).toBe("NONE");
    expect(effectiveLeadFormPosition(form("BEFORE_GAME", 0, 1))).toBe("BEFORE_GAME");
    expect(effectiveLeadFormPosition(null)).toBe("NONE");
  });

  it("a participação segue a posição fixada no início, não a atual", () => {
    expect(participationLeadFormPosition("AFTER_GAME", form("BEFORE_GAME"))).toBe("AFTER_GAME");
    // Participações anteriores à fixação seguem a atual.
    expect(participationLeadFormPosition(null, form("BEFORE_GAME"))).toBe("BEFORE_GAME");
  });

  it("desligar ou esvaziar o formulário liberta as participações em curso", () => {
    expect(participationLeadFormPosition("BEFORE_GAME", form("NONE"))).toBe("NONE");
    expect(participationLeadFormPosition("BEFORE_GAME", form("BEFORE_GAME", 0, 0))).toBe("NONE");
  });

  it("um NONE fixado continua NONE mesmo que se acrescentem campos", () => {
    expect(participationLeadFormPosition("NONE", form("BEFORE_GAME"))).toBe("NONE");
  });
});

describe("holdsPrizeUntilLead", () => {
  it("reserva só quando a lead ainda vem depois do sorteio", () => {
    expect(holdsPrizeUntilLead("AFTER_GAME", false, false)).toBe(true);
    expect(holdsPrizeUntilLead("BEFORE_PRIZE", false, false)).toBe(true);
    expect(holdsPrizeUntilLead("AFTER_GAME", true, false)).toBe(false);
    expect(holdsPrizeUntilLead("BEFORE_GAME", false, false)).toBe(false);
    expect(holdsPrizeUntilLead("NONE", false, false)).toBe(false);
    // Em teste nada é real.
    expect(holdsPrizeUntilLead("AFTER_GAME", false, true)).toBe(false);
  });
});

describe("projectWheelOutcome", () => {
  const won = {
    segmentId: "s1",
    segmentName: "Ganhou",
    outcome: "WIN" as const,
    message: "Parabéns",
    prize: { id: "prize-interno", publicName: "Voucher", instructions: "Mostre no balcão" },
    delivery: "confirmed" as const,
    code: "ABC-123",
  };

  it("com o prémio retido, não envia nome, instruções nem código", () => {
    const projected = projectWheelOutcome({ ...won, delivery: "reserved", code: null }, "withhold_prize");

    expect(projected.prize).toBeNull();
    expect(projected.prizePending).toBe(true);
    const json = JSON.stringify(projected);
    for (const secret of ["Voucher", "Mostre no balcão", "ABC-123", "prize-interno"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("com o código retido, mostra o prémio mas não o código nem as instruções", () => {
    const projected = projectWheelOutcome(won, "withhold_code");

    expect(projected.prize).toEqual({ publicName: "Voucher", instructions: null, code: null });
    expect(projected.prizePending).toBe(true);
    expect(JSON.stringify(projected)).not.toContain("ABC-123");
    expect(JSON.stringify(projected)).not.toContain("Mostre no balcão");
  });

  it("revelado, nunca inclui o id interno do prémio", () => {
    const projected = projectWheelOutcome(won, "full");

    expect(projected.prize).toEqual({ publicName: "Voucher", instructions: "Mostre no balcão", code: "ABC-123" });
    expect(JSON.stringify(projected)).not.toContain("prize-interno");
    expect(projected.prizePending).toBe(false);
  });

  it("uma reserva libertada não mostra o prémio e diz que já não está disponível", () => {
    const projected = projectWheelOutcome({ ...won, delivery: "released", code: null }, "full");
    expect(projected.prize).toBeNull();
    expect(projected.prizeUnavailable).toBe(true);
  });

  it("nunca envia um código que não esteja atribuído", () => {
    const reserved = projectWheelOutcome({ ...won, delivery: "reserved", code: "ABC-123" }, "full");
    expect(JSON.stringify(reserved)).not.toContain("ABC-123");
    const test = projectWheelOutcome({ ...won, delivery: "test", code: "ABC-123" }, "full");
    expect(test.prize?.code).toBeNull();
  });

  it("sem prémio não há nada pendente", () => {
    const lost = { ...won, outcome: "NO_WIN" as const, prize: null, delivery: "none" as const, code: null };
    expect(projectWheelOutcome(lost, "withhold_prize").prizePending).toBe(false);
    expect(projectWheelOutcome(lost, "withhold_code").prizePending).toBe(false);
  });
});

describe("extractLeadIdentity", () => {
  const fields = [
    { type: "PHONE", internalKey: "tel", order: 2 },
    { type: "EMAIL", internalKey: "email_secundario", order: 5 },
    { type: "EMAIL", internalKey: "email", order: 0 },
    { type: "FULL_NAME", internalKey: "nome", order: 1 },
  ];

  it("usa o primeiro campo de cada tipo pela ordem do formulário e normaliza e-mail e telefone", () => {
    const identity = extractLeadIdentity(fields, {
      email: "  Ana.Silva@Example.PT ",
      email_secundario: "outro@example.pt",
      nome: " Ana Silva ",
      tel: "912 345 678",
    });

    expect(identity).toEqual({
      email: "ana.silva@example.pt",
      phone: "912345678",
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

describe("normalizePhone", () => {
  it("o mesmo número escrito de formas diferentes é igual", () => {
    for (const variant of ["912 345 678", "912345678", "912-345-678", " 912.345.678 "]) {
      expect(normalizePhone(variant)).toBe("912345678");
    }
    for (const variant of ["+351 912 345 678", "00351 912 345 678", "(+351) 912 345 678", "+351-912-345-678"]) {
      expect(normalizePhone(variant)).toBe("+351912345678");
    }
  });

  it("não adivinha o indicativo", () => {
    expect(normalizePhone("912345678")).not.toBe(normalizePhone("+351912345678"));
  });

  it("sem dígitos é nulo", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("isPlausiblePhone aceita 6 a 15 dígitos", () => {
    expect(isPlausiblePhone("912 345 678")).toBe(true);
    expect(isPlausiblePhone("+351 912 345 678")).toBe(true);
    expect(isPlausiblePhone("12345")).toBe(false);
    expect(isPlausiblePhone("1234567890123456")).toBe(false);
    expect(isPlausiblePhone("abc")).toBe(false);
  });
});
