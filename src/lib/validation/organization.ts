import { z } from "zod";

export const ORGANIZATION_LIMITS = { privacyContactEmail: 254 } as const;

/**
 * Configurações de privacidade da organização (§24). O contacto aparece no
 * jogo público, junto ao formulário de leads e no rodapé. Vazio apaga.
 */
export const privacySettingsShape = {
  privacyContactEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(ORGANIZATION_LIMITS.privacyContactEmail, `Contacto de privacidade: máximo ${ORGANIZATION_LIMITS.privacyContactEmail} caracteres.`)
    .refine((value) => value === "" || z.email().safeParse(value).success, "Contacto de privacidade: e-mail inválido."),
};
