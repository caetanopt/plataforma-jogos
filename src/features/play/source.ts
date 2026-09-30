/**
 * A origem de uma participação (§20, "Origem"): o site de onde o visitante
 * veio, a partir do `document.referrer`. Só o endereço (ex.: "www.google.com"):
 * o caminho e a query de um referrer podem trazer identificadores de quem
 * clicou. Um valor que não seja um endereço web não se guarda.
 */
export function referrerSource(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.host.toLowerCase().slice(0, 200) || undefined;
  } catch {
    return undefined;
  }
}
