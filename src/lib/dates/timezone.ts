/**
 * Conversão entre um valor de `<input type="datetime-local">` (hora "de
 * parede", sem fuso horário) e um instante UTC real, usando o fuso horário
 * IANA da campanha (`campaign.timezone`, ex.: "Europe/Lisbon") — não o fuso
 * horário do processo do servidor (tipicamente UTC em produção), que é o
 * que `new Date("2026-07-20T15:00")` e `Date.prototype.getTimezoneOffset()`
 * usam por omissão. Sem isto, a hora de início/fim de uma agenda podia
 * ficar desviada 0-2h da hora que o marketer realmente configurou.
 *
 * Usa só `Intl.DateTimeFormat`, sem dependências externas.
 */

function offsetMsAt(utcGuess: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcGuess).map((p) => [p.type, p.value]));
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return utcGuess.getTime() - asIfUtc;
}

/**
 * Converte uma string "YYYY-MM-DDTHH:mm" (valor de `datetime-local`,
 * interpretada como hora de parede em `timeZone`) para o instante UTC
 * correspondente.
 */
export function zonedDateTimeToUtc(dateTimeLocal: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dateTimeLocal);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);

  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMs = offsetMsAt(guess, timeZone);
  return new Date(guess.getTime() + offsetMs);
}

/**
 * Converte um instante UTC para o valor "YYYY-MM-DDTHH:mm" que um
 * `<input type="datetime-local">` deve mostrar para representar essa hora
 * em `timeZone`.
 */
export function utcToZonedDateTimeLocal(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}
