import { Inter, Open_Sans, Roboto } from "next/font/google";

/**
 * Tipografias que o editor oferece (ThemeFieldset), além da Montserrat do
 * layout. Sem preload: o browser só descarrega a fonte que o tema usa.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-game-inter", preload: false, display: "swap" });
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-game-roboto",
  preload: false,
  display: "swap",
});
const openSans = Open_Sans({ subsets: ["latin"], variable: "--font-game-open-sans", preload: false, display: "swap" });

/** Classes que definem as variáveis `--font-game-*` (ver public-theme.ts). */
export const gameFontVariables = [inter.variable, roboto.variable, openSans.variable].join(" ");
