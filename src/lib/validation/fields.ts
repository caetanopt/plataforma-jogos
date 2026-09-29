import { z } from "zod";

/**
 * Peças comuns dos schemas do editor. As mensagens levam o nome do campo:
 * aparecem no estado da gravação, longe do input, e "máximo 5000
 * caracteres" sozinho não diz de que campo se trata.
 *
 * Os limites vêm de constantes exportadas pelos schemas e são os mesmos que
 * os inputs usam em `maxLength`/`min`/`max`: o browser trava antes de o
 * servidor recusar.
 */

/** Texto opcional ("" apaga). */
export function textField(label: string, max: number) {
  return z.string().trim().max(max, `${label}: máximo ${max} caracteres.`);
}

/** Texto obrigatório. */
export function requiredTextField(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${label}: obrigatório.`)
    .max(max, `${label}: máximo ${max} caracteres.`);
}

/** Id de media ("" = sem media). A pertença verifica-se na ação. */
export const mediaIdField = z.string().trim().max(60);

function blankTo<T>(replacement: T) {
  return (value: unknown) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? replacement : Number(trimmed);
  };
}

function numberIssue(label: string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? `${label}: obrigatório.` : `${label}: tem de ser um número.`;
}

/**
 * Inteiro obrigatório. Um input apagado ("") é recusado, em vez de o
 * `z.coerce` o transformar em 0 (apagar "Colunas" para escrever outro número
 * gravava 0 ou fazia falhar o formulário inteiro).
 */
export function intField(label: string, min: number, max: number) {
  return z.preprocess(
    blankTo(undefined),
    z
      .number({ error: numberIssue(label) })
      .int(`${label}: tem de ser um número inteiro.`)
      .min(min, `${label}: mínimo ${min}.`)
      .max(max, `${label}: máximo ${max}.`),
  );
}

/** Inteiro opcional: "" passa a null (sem limite). */
export function optionalIntField(label: string, min: number, max: number) {
  return z.preprocess(
    blankTo(null),
    z
      .number({ error: numberIssue(label) })
      .int(`${label}: tem de ser um número inteiro.`)
      .min(min, `${label}: mínimo ${min}.`)
      .max(max, `${label}: máximo ${max}.`)
      .nullable(),
  );
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Link opcional, só http(s) (§25): vai direto para um `href` no jogo
 * público, e um `javascript:` ou `data:` executava no domínio da plataforma.
 */
export function httpUrlField(label: string, max = 500) {
  return z
    .string()
    .trim()
    .max(max, `${label}: máximo ${max} caracteres.`)
    .refine((value) => value === "" || isHttpUrl(value), `${label}: tem de começar por https:// ou http://.`);
}

const DATETIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2})?$/;

/** Data de parede real: sem mês 13, 31 de abril ou 25h (o Date.UTC "dava a volta"). */
export function isValidDateTimeLocal(value: string): boolean {
  const match = DATETIME_LOCAL.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= daysInMonth;
}

/**
 * Valor de `<input type="datetime-local">` ("" = sem data). O ano fica entre
 * 2000 e 2100: ao escrever o ano dígito a dígito o browser emite 0002, 0020,
 * 0202..., e a gravação automática gravava essas datas.
 */
export function dateTimeLocalField(label: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === "" || isValidDateTimeLocal(value), `${label}: data inválida.`);
}

export const checkboxField = z.boolean();
