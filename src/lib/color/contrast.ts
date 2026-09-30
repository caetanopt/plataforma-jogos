/**
 * Cores em hexadecimal (#RRGGBB) e contraste WCAG 2.2 (§27). Usado para
 * aplicar o tema de uma campanha sem deixar texto ilegível: as cores são as
 * da marca, mas o texto sobre elas tem de chegar aos 4,5:1.
 */

export type Rgb = readonly [number, number, number];

/** Mínimo da WCAG 2.2 AA para texto normal. */
export const MIN_TEXT_CONTRAST = 4.5;

export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Mistura sólida: `weight` de `a` e o resto de `b`. É assim que os tons
 * oficiais da Caetano se obtêm (o -80 é 80% da cor com 20% de branco), e dá
 * uma cor opaca em vez de uma transparência que muda com o que está por baixo.
 */
export function mix(a: string, b: string, weight: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  const blend = (i: 0 | 1 | 2) => ca[i] * weight + cb[i] * (1 - weight);
  return toHex([blend(0), blend(1), blend(2)]);
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * A primeira cor com contraste suficiente sobre `background`; sem nenhuma,
 * a de maior contraste. A preferida vem primeiro: só é trocada quando não
 * se lê.
 */
export function readableOn(background: string, candidates: readonly string[], minimum = MIN_TEXT_CONTRAST): string {
  let best = candidates[0] ?? "#000000";
  let bestRatio = 0;
  for (const candidate of candidates) {
    if (!parseHex(candidate)) continue;
    const ratio = contrastRatio(candidate, background);
    if (ratio >= minimum) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
