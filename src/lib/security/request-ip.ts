import { headers } from "next/headers";

/**
 * Lê o IP do pedido a partir de `x-forwarded-for`/`x-real-ip`. Estes
 * cabeçalhos só são fiáveis quando a aplicação corre atrás de um proxy
 * reverso/CDN configurado para os definir e para rejeitar/substituir
 * qualquer valor enviado diretamente por um cliente — este projeto não
 * impõe essa validação (não há uma lista de proxies de confiança), pelo
 * que um cliente que fale diretamente com o servidor pode falsificar este
 * cabeçalho e obter um novo "balde" de rate limit a cada pedido. Em
 * produção atrás de um proxy/CDN corretamente configurado (que sobrescreve
 * este cabeçalho antes de chegar à aplicação) isto deixa de ser um
 * problema; documentado aqui como limitação conhecida do MVP.
 */
export async function getRequestIp(): Promise<string | null> {
  const store = await headers();
  const forwarded = store.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return store.get("x-real-ip");
}
