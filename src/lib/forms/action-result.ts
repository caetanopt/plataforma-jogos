import type { ZodError } from "zod";

/**
 * Resposta das server actions do editor, no formato do `useActionState`.
 *
 * Antes as ações devolviam `void` e saíam com `return;` quando a validação
 * falhava: o browser não distinguia uma recusa de uma gravação, e o editor
 * dizia "Alterações guardadas" em ambos os casos. Cada ramo devolve agora
 * `ok()` ou `fail()`.
 *
 * Sem "use server": é importado pelos componentes cliente e pelas ações.
 */

/** Mensagem por campo, indexada pelo `name` do input. */
export type FieldErrors = Readonly<Record<string, string>>;

export type ActionResult =
  | { readonly status: "idle" }
  | { readonly status: "success"; readonly at: number; readonly message?: string }
  | { readonly status: "error"; readonly at: number; readonly message: string; readonly fieldErrors: FieldErrors };

export type FormAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

export const IDLE: ActionResult = { status: "idle" };

// `at` muda em cada resposta: a mesma mensagem duas vezes seguidas volta a
// ser anunciada e o aviso de sucesso volta a aparecer.
export function ok(message?: string): ActionResult {
  return { status: "success", at: Date.now(), message };
}

export function fail(message: string, fieldErrors: FieldErrors = {}): ActionResult {
  return { status: "error", at: Date.now(), message, fieldErrors };
}

/** Mensagem genérica quando só uma parte do formulário foi gravada. */
export const PARTIAL_SAVE_MESSAGE = "Algumas alterações não foram guardadas.";
export const NOTHING_SAVED_MESSAGE = "As alterações não foram guardadas.";

/** Primeira mensagem de cada campo; erros sem caminho ficam em `_form`. */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    if (!(key in errors)) errors[key] = issue.message;
  }
  return errors;
}

/**
 * Resultado de uma gravação parcial: com erros, diz que parte ficou por
 * gravar; sem erros, confirma.
 */
export function partialResult(fieldErrors: FieldErrors, savedSomething: boolean): ActionResult {
  if (Object.keys(fieldErrors).length === 0) return ok();
  return fail(savedSomething ? PARTIAL_SAVE_MESSAGE : NOTHING_SAVED_MESSAGE, fieldErrors);
}
