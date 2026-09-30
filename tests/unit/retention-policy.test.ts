import { describe, expect, it } from "vitest";
import {
  anonymizationDate,
  describeRetention,
  effectiveRetention,
  MIN_PARTICIPATION_AGE_MS,
  retentionCutoff,
} from "@/features/privacy/retention-policy";
import { campaignRetentionFromForm, campaignRetentionSchema, organizationRetentionSchema } from "@/lib/validation/privacy";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T12:00:00Z");

const campaign = (dataRetentionDays: number | null = null, dataRetentionUntil: Date | null = null) => ({
  dataRetentionDays,
  dataRetentionUntil,
});

describe("prazo de conservação efetivo", () => {
  it("a data da campanha vence os dias; os dias da campanha vencem os da organização", () => {
    const until = new Date("2027-01-01T00:00:00Z");
    expect(effectiveRetention({ campaign: campaign(30, until), organizationDays: 90 })).toEqual({ kind: "until", until });
    expect(effectiveRetention({ campaign: campaign(30), organizationDays: 90 })).toEqual({
      kind: "days",
      days: 30,
      source: "campaign",
    });
    expect(effectiveRetention({ campaign: campaign(), organizationDays: 90 })).toEqual({
      kind: "days",
      days: 90,
      source: "organization",
    });
    expect(effectiveRetention({ campaign: campaign(), organizationDays: null })).toEqual({ kind: "none" });
    // Um valor estragado na base de dados não vira "anonimizar tudo".
    expect(effectiveRetention({ campaign: campaign(0), organizationDays: -5 })).toEqual({ kind: "none" });
  });
});

describe("data de corte", () => {
  it("em dias: tudo o que tem mais do que o prazo", () => {
    const cutoff = retentionCutoff({ kind: "days", days: 30, source: "campaign" }, NOW);
    expect(cutoff).toEqual(new Date(NOW.getTime() - 30 * DAY));
  });

  it("numa data: nada antes dela; depois, tudo com mais de um dia", () => {
    const until = new Date("2026-10-05T00:00:00Z");
    expect(retentionCutoff({ kind: "until", until }, NOW)).toBeNull();
    const after = new Date("2026-10-06T00:00:00Z");
    expect(retentionCutoff({ kind: "until", until }, after)).toEqual(new Date(after.getTime() - MIN_PARTICIPATION_AGE_MS));
  });

  it("sem prazo, nunca", () => {
    expect(retentionCutoff({ kind: "none" }, NOW)).toBeNull();
  });

  it("quando sai cada participação", () => {
    const createdAt = new Date("2026-09-01T10:00:00Z");
    expect(anonymizationDate({ kind: "days", days: 90, source: "organization" }, createdAt)).toEqual(
      new Date(createdAt.getTime() + 90 * DAY),
    );
    const until = new Date("2026-10-05T00:00:00Z");
    expect(anonymizationDate({ kind: "until", until }, createdAt)).toEqual(until);
    // Criada na véspera da data: sai um dia depois de criada, não antes.
    const lastMinute = new Date("2026-10-04T23:00:00Z");
    expect(anonymizationDate({ kind: "until", until }, lastMinute)).toEqual(new Date(lastMinute.getTime() + DAY));
    expect(anonymizationDate({ kind: "none" }, createdAt)).toBeNull();
  });

  it("a descrição diz de onde vem o prazo", () => {
    expect(describeRetention({ kind: "days", days: 90, source: "organization" }, "Europe/Lisbon")).toBe(
      "90 dias depois de cada participação (prazo da organização).",
    );
    expect(describeRetention({ kind: "until", until: new Date("2027-01-01T00:00:00Z") }, "Europe/Lisbon")).toBe(
      "A partir de 1 de janeiro de 2027, todas as participações.",
    );
  });
});

describe("validação dos formulários", () => {
  it("organização: sem prazo ou um dos prazos sugeridos", () => {
    expect(organizationRetentionSchema.parse("")).toBeNull();
    expect(organizationRetentionSchema.parse("90")).toBe(90);
    expect(organizationRetentionSchema.safeParse("45").success).toBe(false);
    expect(organizationRetentionSchema.safeParse("0").success).toBe(false);
  });

  it("campanha: herdar, dias sugeridos ou uma data válida", () => {
    expect(campaignRetentionSchema.parse(campaignRetentionFromForm("inherit", ""))).toEqual({ mode: "inherit" });
    expect(campaignRetentionSchema.parse(campaignRetentionFromForm("180", ""))).toEqual({ mode: "days", days: 180 });
    expect(campaignRetentionSchema.parse(campaignRetentionFromForm("until", "2027-01-01"))).toEqual({
      mode: "until",
      date: "2027-01-01",
    });
    expect(campaignRetentionSchema.safeParse(campaignRetentionFromForm("until", "")).success).toBe(false);
    expect(campaignRetentionSchema.safeParse(campaignRetentionFromForm("7", "")).success).toBe(false);
  });
});
