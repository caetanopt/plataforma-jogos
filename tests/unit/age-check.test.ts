import { describe, expect, it } from "vitest";
import { editBreaksLiveAgeCheck, isAgeVerifiable, type AgeCheckForm } from "@/features/publishing/age-check";

const withBirthDate: AgeCheckForm = {
  position: "BEFORE_GAME",
  fields: [{ type: "EMAIL" }, { type: "BIRTH_DATE" }],
  consentCount: 0,
};
const withoutBirthDate: AgeCheckForm = { position: "BEFORE_GAME", fields: [{ type: "EMAIL" }], consentCount: 1 };

describe("isAgeVerifiable", () => {
  it("sem idade mínima, não há nada a verificar", () => {
    expect(isAgeVerifiable(null, null)).toBe(true);
    expect(isAgeVerifiable(null, withoutBirthDate)).toBe(true);
  });

  it("exige a data de nascimento num formulário que entra no fluxo", () => {
    expect(isAgeVerifiable(18, withBirthDate)).toBe(true);
    expect(isAgeVerifiable(18, { ...withBirthDate, position: "AFTER_GAME" })).toBe(true);
    expect(isAgeVerifiable(18, withoutBirthDate)).toBe(false);
    expect(isAgeVerifiable(18, { ...withBirthDate, position: "NONE" })).toBe(false);
    expect(isAgeVerifiable(18, null)).toBe(false);
  });
});

describe("editBreaksLiveAgeCheck", () => {
  const verifiable = { minAge: 18, form: withBirthDate };
  const unverifiable = { minAge: 18, form: withoutBirthDate };

  it("recusa, numa campanha publicada, o que deixa de verificar a idade", () => {
    for (const status of ["PUBLISHED", "SCHEDULED", "PAUSED", "EXPIRED"] as const) {
      expect(editBreaksLiveAgeCheck(status, verifiable, unverifiable)).toBe(true);
    }
    expect(editBreaksLiveAgeCheck("PUBLISHED", { minAge: null, form: withoutBirthDate }, unverifiable)).toBe(true);
  });

  it("não recusa em rascunho nem o que já estava assim", () => {
    expect(editBreaksLiveAgeCheck("DRAFT", verifiable, unverifiable)).toBe(false);
    expect(editBreaksLiveAgeCheck("ARCHIVED", verifiable, unverifiable)).toBe(false);
    expect(editBreaksLiveAgeCheck("PUBLISHED", unverifiable, { minAge: 21, form: withoutBirthDate })).toBe(false);
    expect(editBreaksLiveAgeCheck("PUBLISHED", unverifiable, { minAge: null, form: withoutBirthDate })).toBe(false);
    expect(editBreaksLiveAgeCheck("PUBLISHED", verifiable, { minAge: 21, form: withBirthDate })).toBe(false);
  });
});
