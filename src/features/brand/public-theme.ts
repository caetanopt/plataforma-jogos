import { contrastRatio, MIN_TEXT_CONTRAST, mix, parseHex, readableOn, relativeLuminance } from "@/lib/color/contrast";

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
  | "--game-subtle-text"
  | "--game-primary"
  | "--game-accent"
  | "--game-accent-tint"
  | "--game-selected-text"
  | "--game-highlight"
  | "--game-highlight-text"
  | "--game-success-tint"
  | "--game-success-border"
  | "--game-success-text"
  | "--game-danger"
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
  /** Controlos nativos (calendário, listas) escuros num tema escuro. */
  colorScheme: "light" | "dark";
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
// Sem sombra, mas uma sombra válida: com "none" o box-shadow composto do
// Tailwind ficava inválido e levava o anel de foco com ele.
const NO_SHADOW = "0 0 #0000";

/** Contorno de campos (WCAG 1.4.11). */
const MIN_NON_TEXT_CONTRAST = 3;

// Cores funcionais (globals.css): sucesso (verde eco) e erro.
const SUCCESS = "#49B489";
const DANGER_CANDIDATES = ["#B3261E", "#8C1D18", "#F2B8B5"] as const;
const CAETANO_TEXT = "#2E3A46";
const CAETANO_NEUTRALS = { subtle: "#EBEFF1", border: "#D7DFE3" } as const;

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

/** A mistura mais leve de `color` sobre `background` que chega a `minimum`. */
function strongEnough(color: string, background: string, minimum: number, weights: readonly number[]): string {
  for (const weight of weights) {
    const candidate = mix(color, background, weight);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
  }
  return color;
}

/** Texto legível sobre `background`, a começar pelas cores do tema. */
function textOn(background: string, preferred: readonly string[]): string {
  return readableOn(background, [...preferred, "#000000", "#FFFFFF"]);
}

export function resolvePublicTheme(source: PublicThemeSource | null): ResolvedPublicTheme {
  const background = color(source?.backgroundColor ?? "", FALLBACK.background);
  const configuredText = color(source?.textColor ?? "", FALLBACK.text);
  const primary = color(source?.primaryColor ?? "", FALLBACK.primary);
  const secondary = color(source?.secondaryColor ?? "", FALLBACK.secondary);
  const button = color(source?.buttonColor ?? "", FALLBACK.button);
  const configuredButtonText = color(source?.buttonTextColor ?? "", FALLBACK.buttonText);

  const text = textOn(background, [configuredText]);
  // Os tons -80/-60/-40/-20 da Caetano são exatamente misturas com branco:
  // num tema Caetano, estas contas dão os tons oficiais.
  const mutedCandidate = mix(text, background, 0.8);
  const muted = contrastRatio(mutedCandidate, background) >= MIN_TEXT_CONTRAST ? mutedCandidate : text;
  const caetanoSurface = text === CAETANO_TEXT && background === "#FFFFFF";
  const subtle = caetanoSurface ? CAETANO_NEUTRALS.subtle : mix(text, background, 0.08);
  const border = caetanoSurface ? CAETANO_NEUTRALS.border : mix(text, background, 0.2);
  // Links e destaques em texto: a cor primária, se se ler sobre o fundo.
  const accent = readableOn(background, [primary, text]);
  const accentTint = mix(accent, background, 0.2);
  const highlight = mix(secondary, background, 0.2);
  const successTint = mix(SUCCESS, background, 0.2);

  const buttonText = textOn(button, [configuredButtonText, text]);
  const hoverCandidate = mix(button, background, 0.8);
  const buttonHover = contrastRatio(buttonText, hoverCandidate) >= MIN_TEXT_CONTRAST ? hoverCandidate : button;

  const radius = Math.min(48, Math.max(0, Math.round(source?.borderRadiusPx ?? 8)));

  return {
    backgroundColor: background,
    colorScheme: relativeLuminance(text) > relativeLuminance(background) ? "dark" : "light",
    variables: {
      "--game-surface": background,
      "--game-text": text,
      "--game-muted": muted,
      "--game-border": border,
      // Contornos de campos: a mistura mais leve do texto que chega a 3:1.
      "--game-border-strong": strongEnough(text, background, MIN_NON_TEXT_CONTRAST, [0.6, 0.7, 0.8, 0.9, 1]),
      "--game-subtle": subtle,
      "--game-subtle-text": textOn(subtle, [text]),
      "--game-primary": primary,
      "--game-accent": accent,
      "--game-accent-tint": accentTint,
      "--game-selected-text": textOn(accentTint, [accent, text]),
      "--game-highlight": highlight,
      "--game-highlight-text": textOn(highlight, [text]),
      "--game-success-tint": successTint,
      "--game-success-border": mix(SUCCESS, background, 0.4),
      "--game-success-text": textOn(successTint, [text]),
      "--game-danger": readableOn(background, [...DANGER_CANDIDATES, text]),
      "--game-button": button,
      "--game-button-hover": buttonHover,
      "--game-button-text": buttonText,
      "--game-radius": `${radius}px`,
      "--game-radius-lg": `${Math.round(radius * 1.5)}px`,
      "--game-shadow": source?.shadowEnabled === false ? NO_SHADOW : SHADOW,
      "--game-font": fontStack(source?.fontFamily ?? "Montserrat"),
    },
  };
}

function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1).replace(".", ",")}:1`;
}

/**
 * O que a página pública muda no tema gravado para se ler (resolvePublicTheme),
 * para o editor avisar. Cada aviso corresponde a um par de cores desenhado.
 */
export function themeContrastWarnings(source: PublicThemeSource): string[] {
  const { variables: v } = resolvePublicTheme(source);
  const background = color(source.backgroundColor, FALLBACK.background);
  const configuredText = color(source.textColor, FALLBACK.text);
  const primary = color(source.primaryColor, FALLBACK.primary);
  const button = color(source.buttonColor, FALLBACK.button);
  const configuredButtonText = color(source.buttonTextColor, FALLBACK.buttonText);
  const warnings: string[] = [];

  if (v["--game-text"] !== configuredText) {
    warnings.push(
      `A cor do texto sobre a cor de fundo tem contraste ${formatRatio(contrastRatio(configuredText, background))} (mínimo 4,5:1). Na página pública o texto sai em ${v["--game-text"]}.`,
    );
  }
  if (v["--game-button-text"] !== configuredButtonText) {
    warnings.push(
      `O texto dos botões sobre a cor dos botões tem contraste ${formatRatio(contrastRatio(configuredButtonText, button))} (mínimo 4,5:1). Na página pública o texto dos botões sai em ${v["--game-button-text"]}.`,
    );
  }
  if (v["--game-accent"] !== primary) {
    warnings.push(
      `A cor primária sobre a cor de fundo tem contraste ${formatRatio(contrastRatio(primary, background))} (mínimo 4,5:1): os links e destaques em texto saem na cor do texto.`,
    );
  }
  if (contrastRatio(primary, background) < MIN_NON_TEXT_CONTRAST) {
    warnings.push(
      `A cor primária quase não se distingue da cor de fundo (${formatRatio(contrastRatio(primary, background))}, mínimo 3:1): as costas das cartas da memória e o aro da roda ficam pouco visíveis.`,
    );
  }
  if (v["--game-highlight-text"] !== v["--game-text"]) {
    warnings.push(
      `O texto não se lê sobre o tom da cor secundária usado nas caixas de destaque (prémio, resultado): nessas caixas o texto sai em ${v["--game-highlight-text"]}.`,
    );
  }
  if (v["--game-selected-text"] !== v["--game-accent"]) {
    warnings.push(
      `A resposta escolhida no quiz não se lê na cor primária: sai em ${v["--game-selected-text"]}.`,
    );
  }
  if (v["--game-subtle-text"] !== v["--game-text"]) {
    warnings.push(
      `O texto não se lê sobre o tom de fundo das caixas de regulamento e avisos: nessas caixas sai em ${v["--game-subtle-text"]}.`,
    );
  }
  if (v["--game-success-text"] !== v["--game-text"]) {
    warnings.push(`O texto não se lê sobre o verde das cartas encontradas na memória: sai em ${v["--game-success-text"]}.`);
  }
  if (!(DANGER_CANDIDATES as readonly string[]).includes(v["--game-danger"])) {
    warnings.push(
      `Nenhum vermelho se lê sobre a cor de fundo: os erros e os campos obrigatórios deixam de sair a vermelho e saem em ${v["--game-danger"]}.`,
    );
  }
  return warnings;
}
