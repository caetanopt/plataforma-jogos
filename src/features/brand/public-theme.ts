import { contrastRatio, MIN_TEXT_CONTRAST, mix, parseHex, readableOn } from "@/lib/color/contrast";

/**
 * Tema de uma campanha aplicado à página pública (§10). Antes a etapa "Marca
 * e design" e os brand kits não tinham efeito nenhum: o jogo saía sempre
 * azul Caetano.
 *
 * As cores chegam aos componentes como variáveis CSS (`--game-*`, ver
 * globals.css), com os valores Caetano por omissão. As cores da marca usam-se
 * tal como estão; o texto é que tem de se ler (§27): quando uma combinação
 * não chega aos 4,5:1, a página usa outra cor de texto e o editor avisa.
 */

export interface PublicThemeSource {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: string;
  borderRadiusPx: number;
  shadowEnabled: boolean;
}

export type GameThemeVariable =
  | "--game-surface"
  | "--game-text"
  | "--game-muted"
  | "--game-border"
  | "--game-border-strong"
  | "--game-subtle"
  | "--game-primary"
  | "--game-accent"
  | "--game-accent-tint"
  | "--game-selected-text"
  | "--game-highlight"
  | "--game-button"
  | "--game-button-hover"
  | "--game-button-text"
  | "--game-radius"
  | "--game-radius-lg"
  | "--game-shadow"
  | "--game-font";

export interface ResolvedPublicTheme {
  variables: Record<GameThemeVariable, string>;
  /** Cor da página, por baixo da imagem de fundo. */
  backgroundColor: string;
}

const FALLBACK = {
  background: "#FFFFFF",
  text: "#2E3A46",
  primary: "#002E5D",
  secondary: "#00AEEF",
  button: "#002E5D",
  buttonText: "#FFFFFF",
} as const;

const SHADOW = "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)";

/**
 * As tipografias do editor (ThemeFieldset) têm a fonte carregada na página
 * pública (game-fonts.ts). Um nome fora da lista (brand kit antigo) usa-se
 * tal como está, se o dispositivo a tiver.
 */
const FONT_STACKS: Record<string, string> = {
  Montserrat: "var(--font-montserrat)",
  Inter: "var(--font-game-inter)",
  Roboto: "var(--font-game-roboto)",
  "Open Sans": "var(--font-game-open-sans)",
  Arial: "Arial",
};

export function fontStack(fontFamily: string): string {
  const known = FONT_STACKS[fontFamily];
  if (known) return `${known}, Arial, Helvetica, sans-serif`;
  // Só letras, algarismos, espaços e hífenes: o valor vai para um style.
  const safe = fontFamily.replace(/[^\p{L}\p{N} -]/gu, "").trim();
  return safe ? `"${safe}", Arial, Helvetica, sans-serif` : "Arial, Helvetica, sans-serif";
}

function color(value: string, fallback: string): string {
  return parseHex(value) ? value.toUpperCase() : fallback;
}

export function resolvePublicTheme(source: PublicThemeSource | null): ResolvedPublicTheme {
  const background = color(source?.backgroundColor ?? "", FALLBACK.background);
  const configuredText = color(source?.textColor ?? "", FALLBACK.text);
  const primary = color(source?.primaryColor ?? "", FALLBACK.primary);
  const secondary = color(source?.secondaryColor ?? "", FALLBACK.secondary);
  const button = color(source?.buttonColor ?? "", FALLBACK.button);
  const configuredButtonText = color(source?.buttonTextColor ?? "", FALLBACK.buttonText);

  const text = readableOn(background, [configuredText, "#000000", "#FFFFFF"]);
  // Os tons -80/-20 da Caetano são exatamente estas misturas com branco.
  const mutedCandidate = mix(text, background, 0.8);
  const muted = contrastRatio(mutedCandidate, background) >= MIN_TEXT_CONTRAST ? mutedCandidate : text;
  // Links e destaques em texto: a cor primária, se se ler sobre o fundo.
  const accent = readableOn(background, [primary, text]);
  const accentTint = mix(accent, background, 0.15);
  const highlightCandidate = mix(secondary, background, 0.2);
  const highlight =
    contrastRatio(text, highlightCandidate) >= MIN_TEXT_CONTRAST ? highlightCandidate : mix(text, background, 0.08);

  const buttonText = readableOn(button, [configuredButtonText, text, "#FFFFFF", "#000000"]);
  const hoverCandidate = mix(button, background, 0.8);
  const buttonHover = contrastRatio(buttonText, hoverCandidate) >= MIN_TEXT_CONTRAST ? hoverCandidate : button;

  const radius = Math.min(48, Math.max(0, Math.round(source?.borderRadiusPx ?? 8)));

  return {
    backgroundColor: background,
    variables: {
      "--game-surface": background,
      "--game-text": text,
      "--game-muted": muted,
      "--game-border": mix(text, background, 0.2),
      // Contornos de campos: 60% do texto dá pelo menos 3:1 no fundo (§27).
      "--game-border-strong": mix(text, background, 0.6),
      "--game-subtle": mix(text, background, 0.08),
      "--game-primary": primary,
      "--game-accent": accent,
      "--game-accent-tint": accentTint,
      "--game-selected-text": readableOn(accentTint, [accent, text]),
      "--game-highlight": highlight,
      "--game-button": button,
      "--game-button-hover": buttonHover,
      "--game-button-text": buttonText,
      "--game-radius": `${radius}px`,
      "--game-radius-lg": `${Math.round(radius * 1.5)}px`,
      "--game-shadow": source?.shadowEnabled === false ? "none" : SHADOW,
      "--game-font": fontStack(source?.fontFamily ?? "Montserrat"),
    },
  };
}

function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",")}:1`;
}

/**
 * Combinações do tema gravado que não se leem, para o editor avisar. A
 * página pública já as corrige (resolvePublicTheme); o aviso diz o que muda.
 */
export function themeContrastWarnings(source: PublicThemeSource): string[] {
  const resolved = resolvePublicTheme(source);
  const warnings: string[] = [];
  const background = color(source.backgroundColor, FALLBACK.background);

  const textRatio = contrastRatio(color(source.textColor, FALLBACK.text), background);
  if (textRatio < MIN_TEXT_CONTRAST) {
    warnings.push(
      `A cor do texto sobre a cor de fundo tem contraste ${formatRatio(textRatio)} (mínimo 4,5:1). Na página pública o texto sai em ${resolved.variables["--game-text"]}.`,
    );
  }
  const button = color(source.buttonColor, FALLBACK.button);
  const buttonRatio = contrastRatio(color(source.buttonTextColor, FALLBACK.buttonText), button);
  if (buttonRatio < MIN_TEXT_CONTRAST) {
    warnings.push(
      `O texto dos botões sobre a cor dos botões tem contraste ${formatRatio(buttonRatio)} (mínimo 4,5:1). Na página pública o texto dos botões sai em ${resolved.variables["--game-button-text"]}.`,
    );
  }
  const primaryRatio = contrastRatio(color(source.primaryColor, FALLBACK.primary), background);
  if (primaryRatio < MIN_TEXT_CONTRAST) {
    warnings.push(
      `A cor primária sobre a cor de fundo tem contraste ${formatRatio(primaryRatio)} (mínimo 4,5:1): os links e destaques em texto saem na cor do texto.`,
    );
  }
  return warnings;
}
