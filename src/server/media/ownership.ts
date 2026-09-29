import { prisma } from "@/server/db/client";

/**
 * Verdadeiro se todos os ids de media (não vazios) pertencem à organização.
 *
 * As ações do editor gravavam o id de media que viesse no formulário; como
 * as páginas também liam a media só pelo id, uma campanha podia mostrar a
 * media carregada por outra organização (isolamento multi-tenant, §25).
 */
export async function mediaBelongsToOrganization(
  organizationId: string,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<boolean> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return true;
  const owned = await prisma.mediaAsset.count({ where: { id: { in: wanted }, organizationId } });
  return owned === wanted.length;
}
