import { redirect } from "next/navigation";
import { requireOrgContext, type OrgContext } from "@/server/auth/session";
import { can, type PermissionAction } from "@/server/permissions";

/**
 * Autorização de uma página do backoffice, feita na própria página.
 *
 * Um layout não é fronteira de autorização: com Partial Rendering não volta
 * a renderizar na navegação, e um pedido RSC pode pedir só o segmento da
 * página (ver a documentação do Next, 02-guides/authentication.md). O editor
 * de campanhas só verificava `campaign:edit` no layout — um Visualizador que
 * pedisse o segmento de /apps/[id]/jogo lia os códigos dos vouchers, os pesos
 * da roda e as respostas certas do quiz.
 *
 * Sem permissão, redireciona para uma página que o explica, em vez de lançar
 * um erro que aparecia como falha genérica. (`forbidden()` do Next ainda é
 * experimental.)
 */
export async function requirePagePermission(action: PermissionAction): Promise<OrgContext> {
  const context = await requireOrgContext();
  if (!can(context, action)) redirect("/sem-permissao");
  return context;
}
