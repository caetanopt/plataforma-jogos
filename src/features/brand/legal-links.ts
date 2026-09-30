import { isHttpUrl } from "@/lib/validation/fields";

/**
 * Links legais do tema (§10, §24): política de privacidade, termos e
 * cookies, mostrados no jogo público junto ao formulário e no rodapé.
 * Gravados em `CampaignTheme.legalLinks` (JSON).
 */
export const LEGAL_LINK_KEYS = ["privacyPolicyUrl", "termsUrl", "cookiesUrl"] as const;
export type LegalLinkKey = (typeof LEGAL_LINK_KEYS)[number];
export type LegalLinks = Record<LegalLinkKey, string | null>;

export const LEGAL_LINK_LABELS: Record<LegalLinkKey, string> = {
  privacyPolicyUrl: "Política de privacidade",
  termsUrl: "Termos e condições",
  cookiesUrl: "Política de cookies",
};

/** Só links http(s): o valor vai para um `href` na página pública. */
export function readLegalLinks(value: unknown): LegalLinks {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const links = {} as LegalLinks;
  for (const key of LEGAL_LINK_KEYS) {
    const raw = source[key];
    links[key] = typeof raw === "string" && isHttpUrl(raw.trim()) ? raw.trim() : null;
  }
  return links;
}

/** Junta ao gravado os links que o formulário enviou (`undefined` = mantém). */
export function mergeLegalLinks(stored: unknown, changes: Partial<Record<LegalLinkKey, string | null>>): LegalLinks {
  const merged = readLegalLinks(stored);
  for (const key of LEGAL_LINK_KEYS) {
    const change = changes[key];
    if (change !== undefined) merged[key] = change;
  }
  return merged;
}

/** Os links preenchidos, pela ordem do editor, para o jogo público. */
export function publicLegalLinks(value: unknown): Array<{ key: LegalLinkKey; label: string; url: string }> {
  const links = readLegalLinks(value);
  return LEGAL_LINK_KEYS.flatMap((key) => {
    const url = links[key];
    return url ? [{ key, label: LEGAL_LINK_LABELS[key], url }] : [];
  });
}
