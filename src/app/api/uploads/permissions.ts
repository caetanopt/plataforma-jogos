import type { PermissionAction } from "@/server/permissions";

/**
 * Carregar media serve o editor de campanhas e a identidade visual. Antes
 * bastava ter sessão: um Visualizador ou Analista obtinha URLs assinados
 * para escrever no bucket e registava media na organização.
 */
export const UPLOAD_PERMISSIONS: readonly PermissionAction[] = ["campaign:edit", "brand:manage"];
