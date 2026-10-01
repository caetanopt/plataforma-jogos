import { z } from "zod";
import {
  checkboxField,
  httpUrlField,
  intField,
  mediaIdField,
  requiredTextField,
  textField,
} from "@/lib/validation/fields";
import { LEGAL_LINK_KEYS, LEGAL_LINK_LABELS, type LegalLinkKey } from "@/features/brand/legal-links";
import { emptyToNull, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";

/** Tema de uma campanha ou brand kit (§10), gravado automaticamente. */
const hexColor = (label: string) =>
  z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, `${label}: cor inválida.`);

export const BRAND_THEME_LIMITS = {
  name: 120,
  logoAltText: 200,
  fontFamily: 60,
  borderRadiusMin: 0,
  borderRadiusMax: 48,
} as const;

export const brandThemeShape = {
  name: requiredTextField("Nome", BRAND_THEME_LIMITS.name),
  logoMediaId: mediaIdField,
  // "" apaga: o jogo volta ao nome da organização.
  logoAltText: textField("Texto alternativo do logótipo", BRAND_THEME_LIMITS.logoAltText),
  faviconMediaId: mediaIdField,
  backgroundImageMediaId: mediaIdField,
  primaryColor: hexColor("Cor primária"),
  secondaryColor: hexColor("Cor secundária"),
  backgroundColor: hexColor("Cor de fundo"),
  textColor: hexColor("Cor do texto"),
  buttonColor: hexColor("Cor dos botões"),
  buttonTextColor: hexColor("Cor do texto dos botões"),
  fontFamily: requiredTextField("Tipografia", BRAND_THEME_LIMITS.fontFamily),
  borderRadiusPx: intField("Border radius", BRAND_THEME_LIMITS.borderRadiusMin, BRAND_THEME_LIMITS.borderRadiusMax),
  shadowEnabled: checkboxField,
  privacyPolicyUrl: httpUrlField(LEGAL_LINK_LABELS.privacyPolicyUrl),
  termsUrl: httpUrlField(LEGAL_LINK_LABELS.termsUrl),
  cookiesUrl: httpUrlField(LEGAL_LINK_LABELS.cookiesUrl),
};

/**
 * Lê e valida o tema campo a campo, para as duas ações que o gravam (tema da
 * campanha e brand kit). Um campo que o formulário não enviou fica
 * `undefined` no `update` e o valor gravado mantém-se; "" nos media apaga.
 *
 * `includeName`: o nome só se edita no brand kit; o da campanha não tem campo.
 */
export function parseThemeForm(formData: FormData, { includeName }: { includeName: boolean }) {
  const parse = parsePartial(brandThemeShape, {
    name: includeName ? readOptional(formData, "name") : undefined,
    logoMediaId: readOptional(formData, "logoMediaId"),
    logoAltText: readOptional(formData, "logoAltText"),
    faviconMediaId: readOptional(formData, "faviconMediaId"),
    backgroundImageMediaId: readOptional(formData, "backgroundImageMediaId"),
    primaryColor: readOptional(formData, "primaryColor"),
    secondaryColor: readOptional(formData, "secondaryColor"),
    backgroundColor: readOptional(formData, "backgroundColor"),
    textColor: readOptional(formData, "textColor"),
    buttonColor: readOptional(formData, "buttonColor"),
    buttonTextColor: readOptional(formData, "buttonTextColor"),
    fontFamily: readOptional(formData, "fontFamily"),
    borderRadiusPx: readOptional(formData, "borderRadiusPx"),
    shadowEnabled: readCheckbox(formData, "shadowEnabled"),
    privacyPolicyUrl: readOptional(formData, "privacyPolicyUrl"),
    termsUrl: readOptional(formData, "termsUrl"),
    cookiesUrl: readOptional(formData, "cookiesUrl"),
  });
  const { data } = parse;

  // Os links legais vivem num JSON: a ação junta-os ao gravado
  // (mergeLegalLinks). "" apaga.
  const legalLinkChanges: Partial<Record<LegalLinkKey, string | null>> = {};
  for (const key of LEGAL_LINK_KEYS) {
    if (data[key] !== undefined) legalLinkChanges[key] = emptyToNull(data[key]) ?? null;
  }

  const update = {
    name: data.name,
    logoMediaId: emptyToNull(data.logoMediaId),
    logoAltText: emptyToNull(data.logoAltText),
    faviconMediaId: emptyToNull(data.faviconMediaId),
    backgroundImageMediaId: emptyToNull(data.backgroundImageMediaId),
    primaryColor: data.primaryColor,
    secondaryColor: data.secondaryColor,
    backgroundColor: data.backgroundColor,
    textColor: data.textColor,
    buttonColor: data.buttonColor,
    buttonTextColor: data.buttonTextColor,
    fontFamily: data.fontFamily,
    borderRadiusPx: data.borderRadiusPx,
    shadowEnabled: data.shadowEnabled,
  };

  return {
    update,
    legalLinkChanges,
    fieldErrors: parse.fieldErrors,
    /** Para a verificação de pertença à organização. */
    mediaIds: [data.logoMediaId, data.faviconMediaId, data.backgroundImageMediaId],
    savedSomething:
      Object.values(update).some((value) => value !== undefined) || Object.keys(legalLinkChanges).length > 0,
  };
}

const brandKitName = requiredTextField("Nome do brand kit", BRAND_THEME_LIMITS.name);

/** Novo brand kit vazio (página Identidade visual). */
export const createBrandKitSchema = z.object({ name: brandKitName });

/** Guardar o tema de uma campanha como brand kit (etapa Marca e design). */
export const saveAsBrandKitSchema = z.object({ kitName: brandKitName });

/** Logótipo oficial da organização ("" = sem logótipo). */
export const organizationLogoShape = { logoMediaId: mediaIdField };
