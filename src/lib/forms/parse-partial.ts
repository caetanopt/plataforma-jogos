import type { z } from "zod";

export interface PartialParse<Shape extends z.ZodRawShape> {
  /** Só os campos enviados e válidos. */
  data: { [K in keyof Shape]?: z.output<Shape[K]> };
  /** Mensagem do primeiro problema de cada campo inválido. */
  fieldErrors: Record<string, string>;
}

/**
 * Valida campo a campo em vez do formulário inteiro.
 *
 * Nas ações de gravação automática, um só campo inválido (um regulamento
 * acima do limite, um número apagado para escrever outro) fazia descartar
 * tudo o resto, título incluído. Aqui cada campo vale por si: os válidos
 * gravam-se, os inválidos voltam com a mensagem. Campos `undefined` (que o
 * formulário não enviou) ficam de fora e o valor gravado mantém-se.
 *
 * As regras entre campos (início antes do fim, mínimo abaixo do máximo)
 * verificam-se depois, sobre `data`, pela própria ação.
 */
export function parsePartial<Shape extends z.ZodRawShape>(
  shape: Shape,
  raw: { [K in keyof Shape]?: unknown },
): PartialParse<Shape> {
  const data: Record<string, unknown> = {};
  const fieldErrors: Record<string, string> = {};

  for (const key of Object.keys(raw)) {
    const value = raw[key];
    const schema = shape[key];
    if (value === undefined || !schema) continue;
    const result = (schema as z.ZodType).safeParse(value);
    if (result.success) {
      data[key] = result.data;
    } else {
      fieldErrors[key] = result.error.issues[0]?.message ?? "Valor inválido.";
    }
  }

  return { data: data as PartialParse<Shape>["data"], fieldErrors };
}

/** Tira `key` de `data` e regista o erro (regra entre campos). */
export function rejectField<Shape extends z.ZodRawShape>(
  parse: PartialParse<Shape>,
  key: keyof Shape & string,
  message: string,
): void {
  delete parse.data[key];
  parse.fieldErrors[key] = message;
}
