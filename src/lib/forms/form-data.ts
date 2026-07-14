/**
 * `FormData.get()` devolve `null` quando o campo não existe no DOM no momento
 * do submit (ex.: campos condicionais escondidos por tipo/kind). Os schemas
 * Zod usam `.optional()` (que só aceita `undefined`), por isso convertemos
 * `null` para string vazia antes de validar.
 */
export function getField(formData: FormData, name: string): string {
  return formData.get(name)?.toString() ?? "";
}
