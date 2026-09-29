/**
 * `FormData.get()` devolve `null` quando o campo não existe no DOM no momento
 * do submit (ex.: campos condicionais escondidos por tipo/kind). Os schemas
 * Zod usam `.optional()` (que só aceita `undefined`), por isso convertemos
 * `null` para string vazia antes de validar.
 *
 * Só para ações de criação, em que um campo ausente vale o mesmo que vazio.
 * Nas de edição, usar `readOptional`: um campo que o formulário não tem não
 * pode ser gravado como vazio.
 */
export function getField(formData: FormData, name: string): string {
  return formData.get(name)?.toString() ?? "";
}

/**
 * Valor de texto de um campo, ou `undefined` quando o formulário não o
 * enviou (não existe, ou está `disabled`).
 *
 * É a distinção que faltava entre "campo que este formulário não tem" e
 * "campo apagado": com `getField` as duas davam "" e as ações de edição
 * gravavam null por cima da imagem, das datas ou do código de um segmento
 * que o formulário de edição não mostrava. `undefined` chega ao Prisma, que
 * mantém o valor gravado.
 */
export function readOptional(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Checkbox com sentinela (`CheckboxField`): um `<input type="hidden"
 * value="">` com o mesmo nome antes da checkbox. Presente e marcada → true;
 * só a sentinela → false; nenhuma das duas → `undefined` (manter).
 *
 * Sem a sentinela, uma checkbox desmarcada não vai no FormData e não se
 * distingue de um formulário que não a tem.
 */
export function readCheckbox(formData: FormData, name: string): boolean | undefined {
  if (!formData.has(name)) return undefined;
  return formData.getAll(name).includes("on");
}

/** Grupo de checkboxes com o mesmo nome (e sentinela vazia). */
export function readMultiple(formData: FormData, name: string): string[] | undefined {
  if (!formData.has(name)) return undefined;
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && value !== "");
}

/** "" passa a null (apagar); `undefined` mantém-se (não mexer). */
export function emptyToNull<T>(value: T | "" | undefined): T | null | undefined {
  if (value === undefined) return undefined;
  return value === "" ? null : value;
}
