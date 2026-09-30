/**
 * `next/font/google` só funciona compilado pelo Next (a fonte é descarregada
 * no build). Nos testes (vitest) cada fonte devolve as classes e a variável
 * que o componente espera, sem descarregar nada.
 */
interface FontOptions {
  variable?: string;
}

function font(family: string) {
  return (options: FontOptions = {}) => ({
    className: `font-${family.toLowerCase().replace(/\s+/g, "-")}`,
    variable: options.variable ? `variable-${options.variable.replace(/^--/, "")}` : "",
    style: { fontFamily: family },
  });
}

export const Montserrat = font("Montserrat");
export const Inter = font("Inter");
export const Roboto = font("Roboto");
export const Open_Sans = font("Open Sans");
