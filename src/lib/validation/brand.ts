import { z } from "zod";
import { checkboxField, intField, mediaIdField, requiredTextField } from "@/lib/validation/fields";
import { emptyToNull, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";

/** Tema de uma campanha ou brand kit (§10), gravado automaticamente. */
const hexColor = (label: string) =>
  z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, `${label}: cor inválida.`);

export const BRAND_THEME_LIMITS = { name: 120, fontFamily: 60, borderRadiusMin: 0, borderRadiusMax: 48 } as const;

export const brandThemeShape = {
  name: requiredTextField("Nome", BRAND_THEME_LIMITS.name),
  logoMediaId: mediaIdField,
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
  });
  const { data } = parse;

  const update = {
    name: data.name,
    logoMediaId: emptyToNull(data.logoMediaId),
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
    fieldErrors: parse.fieldErrors,
    /** Para a verificação de pertença à organização. */
    mediaIds: [data.logoMediaId, data.faviconMediaId, data.backgroundImageMediaId],
    savedSomething: Object.values(update).some((value) => value !== undefined),
  };
}

const brandKitName = requiredTextField("Nome do brand kit", BRAND_THEME_LIMITS.name);

/** Novo brand kit vazio (página Identidade visual). */
export const createBrandKitSchema = z.object({ name: brandKitName });

/** Guardar o tema de uma campanha como brand kit (etapa Marca e design). */
export const saveAsBrandKitSchema = z.object({ kitName: brandKitName });

/** Logótipo oficial da organização ("" = sem logótipo). */
export const organizationLogoShape = { logoMediaId: mediaIdField };
