import type { Prisma } from "@/generated/prisma/client";

/**
 * Parâmetros de vista da página inicial (grelha de pastas).
 *
 * Partilhados entre a página e as server actions: as actions precisam de
 * devolver o utilizador ao separador e à ordenação em que estava, e a única
 * forma segura de o fazer é reconstruir o URL a partir desta lista branca.
 * Aceitar um `returnTo` cru vindo do formulário seria um open redirect.
 */

export const FOLDER_TABS = ["ativas", "arquivadas"] as const;
export type FolderTab = (typeof FOLDER_TABS)[number];

export const FOLDER_SORTS = ["name_asc", "name_desc", "recent", "apps_desc"] as const;
export type FolderSort = (typeof FOLDER_SORTS)[number];

export const FOLDER_TAB_LABELS: Record<FolderTab, string> = {
  ativas: "Ativas",
  arquivadas: "Arquivadas",
};

export const FOLDER_SORT_LABELS: Record<FolderSort, string> = {
  name_asc: "Nome (A–Z)",
  name_desc: "Nome (Z–A)",
  recent: "Mais recentes",
  apps_desc: "Mais aplicações",
};

export const FOLDER_SORT_ORDER_BY: Record<FolderSort, Prisma.FolderOrderByWithRelationInput> = {
  name_asc: { name: "asc" },
  name_desc: { name: "desc" },
  recent: { createdAt: "desc" },
  apps_desc: { campaigns: { _count: "desc" } },
};

export function parseFolderTab(value: unknown): FolderTab {
  return FOLDER_TABS.find((tab) => tab === value) ?? "ativas";
}

export function parseFolderSort(value: unknown): FolderSort {
  return FOLDER_SORTS.find((sort) => sort === value) ?? "name_asc";
}

/** URL canónico da grelha. Os valores por omissão ficam fora da query string. */
export function foldersUrl(options: {
  tab?: unknown;
  sort?: unknown;
  error?: string;
  ok?: string;
} = {}): string {
  const tab = parseFolderTab(options.tab);
  const sort = parseFolderSort(options.sort);

  const query = new URLSearchParams();
  if (tab !== "ativas") query.set("tab", tab);
  if (sort !== "name_asc") query.set("sort", sort);
  if (options.error) query.set("error", options.error);
  if (options.ok) query.set("ok", options.ok);

  const suffix = query.toString();
  return suffix ? `/folders?${suffix}` : "/folders";
}
