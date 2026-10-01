/**
 * Um parâmetro repetido na query string (?search=a&search=b) chega como
 * array. Passado ao Prisma como se fosse texto, rebenta com um erro de
 * validação cuja mensagem inclui os argumentos da consulta — o termo de
 * pesquisa, que numa página de leads é um nome, e-mail ou telefone — e o
 * Next imprime-a nos logs. Fica sempre o primeiro valor.
 */
export function firstValues(
  params: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
}

/**
 * O número da página pedido na query string (?page=…). Um valor que não é um
 * inteiro positivo vale 1, e um enorme ("1e20") fica no máximo: passado ao
 * `skip` do Prisma rebentava a consulta e a página dava erro.
 */
export const MAX_PAGE = 100_000;

export function pageParam(value: string | undefined): number {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1;
}
