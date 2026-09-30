import { describe, expect, it } from "vitest";
import { contrastRatio, mix, readableOn } from "@/lib/color/contrast";
import { fontStack, resolvePublicTheme, themeContrastWarnings, type PublicThemeSource } from "@/features/brand/public-theme";

/** Os valores por omissão de um tema novo (schema.prisma, CampaignTheme). */
const SCHEMA_DEFAULT: PublicThemeSource = {
  primaryColor: "#002E5D",
  secondaryColor: "#00AEEF",
  backgroundColor: "#FFFFFF",
  textColor: "#2E3A46",
  buttonColor: "#002E5D",
  buttonTextColor: "#FFFFFF",
  fontFamily: "Montserrat",
  borderRadiusPx: 8,
  shadowEnabled: true,
};

describe("contraste", () => {
  it("dá os valores da WCAG", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    // Branco sobre o azul cyan da Caetano não chega aos 4,5:1.
    expect(contrastRatio("#FFFFFF", "#00AEEF")).toBeLessThan(3);
  });

  it("a mistura com branco dá os tons oficiais da Caetano", () => {
    expect(mix("#2E3A46", "#FFFFFF", 0.8)).toBe("#58616B");
    expect(mix("#00AEEF", "#FFFFFF", 0.2)).toBe("#CCEFFC");
    expect(mix("#002E5D", "#FFFFFF", 0.8)).toBe("#33587D");
  });

  it("escolhe a primeira cor que se lê e, sem nenhuma, a de maior contraste", () => {
    expect(readableOn("#FFFFFF", ["#2E3A46", "#000000"])).toBe("#2E3A46");
    expect(readableOn("#FFFFFF", ["#EEEEEE", "#000000"])).toBe("#000000");
    expect(readableOn("#FFFFFF", ["#EEEEEE", "#DDDDDD"])).toBe("#DDDDDD");
    expect(readableOn("#FFFFFF", ["não é cor", "#000000"])).toBe("#000000");
  });
});

describe("tema na página pública", () => {
  it("sem tema, fica o aspeto Caetano de sempre", () => {
    const { variables, backgroundColor } = resolvePublicTheme(null);
    expect(backgroundColor).toBe("#FFFFFF");
    expect(variables).toMatchObject({
      "--game-text": "#2E3A46",
      "--game-muted": "#58616B",
      "--game-button": "#002E5D",
      "--game-button-text": "#FFFFFF",
      "--game-accent": "#002E5D",
      "--game-radius": "8px",
      "--game-radius-lg": "12px",
    });
  });

  it("usa as cores da marca tal como estão", () => {
    const { variables, backgroundColor } = resolvePublicTheme({
      ...SCHEMA_DEFAULT,
      backgroundColor: "#FFF6D9",
      primaryColor: "#8C1D18",
      buttonColor: "#8C1D18",
      buttonTextColor: "#FFFFFF",
      borderRadiusPx: 20,
      shadowEnabled: false,
    });
    expect(backgroundColor).toBe("#FFF6D9");
    expect(variables["--game-surface"]).toBe("#FFF6D9");
    expect(variables["--game-button"]).toBe("#8C1D18");
    expect(variables["--game-button-text"]).toBe("#FFFFFF");
    expect(variables["--game-accent"]).toBe("#8C1D18");
    expect(variables["--game-radius"]).toBe("20px");
    expect(variables["--game-radius-lg"]).toBe("30px");
    // Uma sombra vazia, não "none": o anel de foco compõe-se com ela.
    expect(variables["--game-shadow"]).toBe("0 0 #0000");
  });

  it("o tema por omissão é o aspeto Caetano e não tem avisos", () => {
    const { variables } = resolvePublicTheme(SCHEMA_DEFAULT);
    expect(variables).toMatchObject({
      "--game-button": "#002E5D",
      "--game-button-text": "#FFFFFF",
      "--game-button-hover": "#33587D",
      "--game-border": "#D7DFE3",
      "--game-subtle": "#EBEFF1",
      "--game-accent-tint": "#CCD5DF",
      "--game-highlight": "#CCEFFC",
    });
    expect(themeContrastWarnings(SCHEMA_DEFAULT)).toEqual([]);
  });

  it("texto que não se lê é trocado por um que se lê, e o editor avisa", () => {
    // O antigo valor por omissão: texto branco sobre cyan nos botões (2,4:1).
    const cyanButton = { ...SCHEMA_DEFAULT, buttonColor: "#00AEEF" };
    const { variables } = resolvePublicTheme(cyanButton);
    expect(variables["--game-button"]).toBe("#00AEEF");
    expect(variables["--game-button-text"]).toBe("#2E3A46");
    expect(contrastRatio(variables["--game-button-text"], variables["--game-button"])).toBeGreaterThanOrEqual(4.5);

    const warnings = themeContrastWarnings(cyanButton);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("O texto dos botões");
    expect(warnings[0]).toContain("#2E3A46");
  });

  it("num fundo escuro, o texto e os links continuam legíveis", () => {
    const dark = {
      ...SCHEMA_DEFAULT,
      backgroundColor: "#111111",
      textColor: "#333333",
      primaryColor: "#002E5D",
      buttonColor: "#FFD23F",
      buttonTextColor: "#111111",
    };
    const { variables } = resolvePublicTheme(dark);
    for (const key of ["--game-text", "--game-muted", "--game-accent"] as const) {
      expect(contrastRatio(variables[key], "#111111")).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(variables["--game-selected-text"], variables["--game-accent-tint"])).toBeGreaterThanOrEqual(4.5);
    expect(themeContrastWarnings(dark).map((warning) => warning.slice(0, 20))).toEqual([
      "A cor do texto sobre",
      "A cor primária sobre",
      // As costas das cartas e o aro da roda usam a primária tal como está.
      "A cor primária quase",
    ]);
  });

  it("todos os pares de cores desenhados se leem, com qualquer tema", () => {
    const themes: PublicThemeSource[] = [
      SCHEMA_DEFAULT,
      { ...SCHEMA_DEFAULT, backgroundColor: "#111111", textColor: "#333333", buttonColor: "#FFD23F", buttonTextColor: "#111111" },
      { ...SCHEMA_DEFAULT, backgroundColor: "#002E5D", textColor: "#FFFFFF", primaryColor: "#66CEF5", secondaryColor: "#FFA931" },
      { ...SCHEMA_DEFAULT, backgroundColor: "#FFA931", textColor: "#FFFFFF", primaryColor: "#FFD23F", buttonColor: "#FFFFFF" },
      { ...SCHEMA_DEFAULT, backgroundColor: "#777777", textColor: "#888888", primaryColor: "#777777", secondaryColor: "#777777" },
    ];
    const textPairs = [
      ["--game-text", "--game-surface"],
      ["--game-muted", "--game-surface"],
      ["--game-accent", "--game-surface"],
      ["--game-danger", "--game-surface"],
      ["--game-subtle-text", "--game-subtle"],
      ["--game-selected-text", "--game-accent-tint"],
      ["--game-highlight-text", "--game-highlight"],
      ["--game-success-text", "--game-success-tint"],
      ["--game-button-text", "--game-button"],
      ["--game-button-text", "--game-button-hover"],
    ] as const;
    for (const theme of themes) {
      const { variables: v } = resolvePublicTheme(theme);
      for (const [foreground, background] of textPairs) {
        expect(contrastRatio(v[foreground], v[background]), `${foreground} sobre ${background} em ${theme.backgroundColor}`).toBeGreaterThanOrEqual(4.5);
      }
      // Contorno dos campos (WCAG 1.4.11).
      expect(contrastRatio(v["--game-border-strong"], v["--game-surface"])).toBeGreaterThanOrEqual(3);
    }
  });

  it("num tema escuro os controlos nativos também são escuros", () => {
    expect(resolvePublicTheme(SCHEMA_DEFAULT).colorScheme).toBe("light");
    expect(resolvePublicTheme({ ...SCHEMA_DEFAULT, backgroundColor: "#111111", textColor: "#FFFFFF" }).colorScheme).toBe("dark");
  });

  it("limita o border radius e ignora cores inválidas", () => {
    const { variables } = resolvePublicTheme({ ...SCHEMA_DEFAULT, borderRadiusPx: 500, primaryColor: "vermelho" });
    expect(variables["--game-radius"]).toBe("48px");
    expect(variables["--game-primary"]).toBe("#002E5D");
  });

  it("tipografias conhecidas usam a fonte carregada; outras só com caracteres seguros", () => {
    expect(fontStack("Inter")).toBe("var(--font-game-inter), Arial, Helvetica, sans-serif");
    expect(fontStack("Montserrat")).toBe("var(--font-montserrat), Arial, Helvetica, sans-serif");
    expect(fontStack("Arial")).toBe("Arial, Arial, Helvetica, sans-serif");
    expect(fontStack("Marca Antiga")).toBe('"Marca Antiga", Arial, Helvetica, sans-serif');
    expect(fontStack('x"; } body { display: none')).toBe('"x  body  display none", Arial, Helvetica, sans-serif');
    expect(fontStack("{};")).toBe("Arial, Helvetica, sans-serif");
  });
});
