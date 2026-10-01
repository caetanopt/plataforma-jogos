import type { CSSProperties, ReactNode } from "react";
import { resolvePublicTheme, type PublicThemeSource } from "@/features/brand/public-theme";
import { gameFontVariables } from "@/components/public-game/game-fonts";
import { parseHex } from "@/lib/color/contrast";
import { cn } from "@/lib/utils";
import styles from "@/components/public-game/public-game.module.css";

/**
 * Contentor do jogo com o tema da campanha: define as variáveis `--game-*`
 * que os componentes do jogo usam (globals.css), a tipografia e o fundo.
 * Serve a página pública e a pré-visualização do editor, que tem de mostrar
 * o que o público vê.
 *
 * Acrescenta a elevação do tema (public-game.module.css) e a cor secundária
 * tal como está, só para luz decorativa (brilhos, confettis): nunca para
 * texto nem para uma superfície com texto, porque o contraste dela não é
 * garantido.
 */
export function GameThemeShell({
  theme,
  backgroundImageUrl,
  className,
  children,
}: {
  theme: PublicThemeSource | null;
  backgroundImageUrl?: string;
  className?: string;
  children: ReactNode;
}) {
  const resolved = resolvePublicTheme(theme);
  const style: CSSProperties & Record<string, string> = {
    ...resolved.variables,
    backgroundColor: resolved.backgroundColor,
    color: "var(--game-text)",
    fontFamily: "var(--game-font)",
    colorScheme: resolved.colorScheme,
  };
  // Sem secundária válida, a luz usa o tom de destaque (--game-glow, CSS).
  if (theme?.secondaryColor && parseHex(theme.secondaryColor)) {
    style["--game-secondary"] = theme.secondaryColor.toUpperCase();
  }
  if (backgroundImageUrl) {
    style.backgroundImage = `url(${JSON.stringify(backgroundImageUrl)})`;
    style.backgroundSize = "cover";
    style.backgroundPosition = "center";
  }

  return (
    <div
      className={cn(
        gameFontVariables,
        styles.shell,
        !backgroundImageUrl && styles.ambient,
        className,
      )}
      data-shadows={theme?.shadowEnabled === false ? "off" : undefined}
      style={style}
    >
      {children}
    </div>
  );
}
