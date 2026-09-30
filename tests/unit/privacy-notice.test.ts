import { describe, expect, it } from "vitest";
import { mergeLegalLinks, publicLegalLinks, readLegalLinks } from "@/features/brand/legal-links";
import { hasPrivacyNotice } from "@/features/publishing/readiness";

describe("links legais", () => {
  it("só aceita links http(s)", () => {
    expect(
      readLegalLinks({
        privacyPolicyUrl: " https://marca.pt/privacidade ",
        termsUrl: "javascript:alert(1)",
        cookiesUrl: 42,
      }),
    ).toEqual({ privacyPolicyUrl: "https://marca.pt/privacidade", termsUrl: null, cookiesUrl: null });
    expect(readLegalLinks(null)).toEqual({ privacyPolicyUrl: null, termsUrl: null, cookiesUrl: null });
    expect(readLegalLinks(["https://x.pt"])).toEqual({ privacyPolicyUrl: null, termsUrl: null, cookiesUrl: null });
  });

  it("junta ao gravado só o que o formulário enviou; null apaga", () => {
    const stored = { privacyPolicyUrl: "https://marca.pt/p", termsUrl: "https://marca.pt/t" };
    expect(mergeLegalLinks(stored, { cookiesUrl: "https://marca.pt/c" })).toEqual({
      privacyPolicyUrl: "https://marca.pt/p",
      termsUrl: "https://marca.pt/t",
      cookiesUrl: "https://marca.pt/c",
    });
    expect(mergeLegalLinks(stored, { termsUrl: null })).toEqual({
      privacyPolicyUrl: "https://marca.pt/p",
      termsUrl: null,
      cookiesUrl: null,
    });
  });

  it("no jogo, só os preenchidos, pela ordem do editor", () => {
    expect(publicLegalLinks({ cookiesUrl: "https://marca.pt/c", privacyPolicyUrl: "https://marca.pt/p" })).toEqual([
      { key: "privacyPolicyUrl", label: "Política de privacidade", url: "https://marca.pt/p" },
      { key: "cookiesUrl", label: "Política de cookies", url: "https://marca.pt/c" },
    ]);
  });
});

describe("aviso de privacidade na publicação", () => {
  type Campaign = Parameters<typeof hasPrivacyNotice>[0];

  function campaign({
    position = "BEFORE_GAME",
    fields = ["EMAIL"],
    consents = 0,
    legalText = null,
    legalLinks = null,
  }: {
    position?: string;
    fields?: string[];
    consents?: number;
    legalText?: string | null;
    legalLinks?: unknown;
  } = {}): Campaign {
    return {
      legalText,
      theme: { legalLinks },
      leadForm: {
        position,
        fields: fields.map((type) => ({ type })),
        consentDefinitions: Array.from({ length: consents }, () => ({})),
      },
    } as unknown as Campaign;
  }

  it("um formulário com dados pessoais precisa de texto legal ou de política de privacidade", () => {
    expect(hasPrivacyNotice(campaign())).toBe(false);
    expect(hasPrivacyNotice(campaign({ legalText: "   " }))).toBe(false);
    expect(hasPrivacyNotice(campaign({ legalLinks: { termsUrl: "https://marca.pt/t" } }))).toBe(false);
    expect(hasPrivacyNotice(campaign({ legalText: "Responsável: Marca, Lda." }))).toBe(true);
    expect(hasPrivacyNotice(campaign({ legalLinks: { privacyPolicyUrl: "https://marca.pt/p" } }))).toBe(true);
  });

  it("sem pedir dados ao participante, não é preciso", () => {
    expect(hasPrivacyNotice({ legalText: null, theme: null, leadForm: null } as unknown as Campaign)).toBe(true);
    expect(hasPrivacyNotice(campaign({ position: "NONE" }))).toBe(true);
    expect(hasPrivacyNotice(campaign({ fields: [] }))).toBe(true);
    expect(hasPrivacyNotice(campaign({ fields: ["HIDDEN"] }))).toBe(true);
    // Só consentimentos, sem campos: nada identifica a pessoa.
    expect(hasPrivacyNotice(campaign({ fields: [], consents: 1 }))).toBe(true);
  });
});
