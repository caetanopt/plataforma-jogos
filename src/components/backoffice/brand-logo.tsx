/* eslint-disable @next/next/no-img-element */

/**
 * Identidade no backoffice.
 *
 * O wordmark "caetano" é um desenho autoral, sem fonte associada (Brand Book
 * 03 — "O lettering não deve ser substituído por qualquer fonte similar,
 * devendo ser usado apenas o ficheiro oficial da marca"). Por isso o
 * logótipo nunca é composto tipograficamente: ou se mostra o ficheiro
 * oficial carregado pela organização, ou mostra-se apenas o nome do produto.
 */

const PRODUCT_NAME = "Plataforma de Jogos";

const SIZE_CLASSES = {
  // Bem acima do mínimo de 14 px definido no manual (02.2).
  sm: "h-7",
  md: "h-8",
  lg: "h-10",
} as const;

const TEXT_SIZE_CLASSES = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
} as const;

export function BrandLogo({
  logoUrl,
  organizationName,
  size = "sm",
  onDark = false,
}: {
  logoUrl?: string | null;
  /** Só é usado como texto alternativo da imagem do logótipo. */
  organizationName?: string;
  size?: keyof typeof SIZE_CLASSES;
  onDark?: boolean;
}) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={organizationName || PRODUCT_NAME}
        className={`${SIZE_CLASSES[size]} w-auto object-contain`}
      />
    );
  }

  return (
    <span
      className={`${TEXT_SIZE_CLASSES[size]} font-bold ${
        onDark ? "text-white" : "text-caetano-deep-blue"
      }`}
    >
      {PRODUCT_NAME}
    </span>
  );
}
