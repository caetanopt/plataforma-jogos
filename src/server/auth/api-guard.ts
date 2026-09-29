import { NextResponse } from "next/server";
import { resolveOrgContext, type OrgContext } from "@/server/auth/session";
import { can, type PermissionAction } from "@/server/permissions";

export type ApiAccess = { ok: true; context: OrgContext } | { ok: false; response: NextResponse };

/**
 * Autorização de uma rota da API. Sem sessão responde 401 e sem permissão 403,
 * em JSON — antes, `requireOrgContext` redirecionava (307 para o HTML do
 * login) e um `assertCan` falhado rebentava com 500.
 *
 * `anyOf`: basta uma das permissões (ex.: carregar media serve o editor de
 * campanhas e a identidade visual).
 */
export async function requireApiPermission(anyOf: readonly PermissionAction[]): Promise<ApiAccess> {
  const result = await resolveOrgContext();
  if (!result.ok) {
    return { ok: false, response: NextResponse.json({ error: "Sessão necessária." }, { status: 401 }) };
  }
  if (!anyOf.some((action) => can(result.context, action))) {
    return { ok: false, response: NextResponse.json({ error: "Sem permissão." }, { status: 403 }) };
  }
  return { ok: true, context: result.context };
}
