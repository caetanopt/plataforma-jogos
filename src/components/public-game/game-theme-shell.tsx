import type { CSSProperties, ReactNode } from "react";
import { resolvePublicTheme, type PublicThemeSource } from "@/features/brand/public-theme";
import { gameFontVariables } from "@/components/public-game/game-fonts";
import { cn } from "@/lib/utils";

/**
 * Contentor do jogo com o tema da campanha: define as variáveis `--game-*`
 * que os componentes do jogo usam (globals.css), a tipografia e o fundo.
 * Serve a página pública e a pré-visualização do editor, que tem de mostrar
 * o que o público vê.
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
  };
  if (backgroundImageUrl) {
    style.backgroundImage = `url(${JSON.stringify(backgroundImageUrl)})`;
    style.backgroundSize = "cover";
    style.backgroundPosition = "center";
  }

  return (
    <div className={cn(gameFontVariables, className)} style={style}>
      {children}
    </div>
  );
}
