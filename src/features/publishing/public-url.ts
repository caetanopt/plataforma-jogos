/**
 * O endereço público de uma campanha a partir do slug (§19, link direto): o
 * mesmo que a etapa Publicação mostra e o QR Code leva.
 */
export function publicPlayUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/play/${slug}`;
}
