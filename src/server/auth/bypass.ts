/**
 * `DISABLE_AUTH=true` autentica todos os pedidos como o utilizador ativo mais
 * antigo — normalmente o superadmin. Serve só para desenvolvimento local.
 *
 * Num build de produção (`next build`/`next start`, incluindo os previews do
 * Vercel, que também correm com NODE_ENV=production) a flag é ignorada: bastava
 * uma variável de ambiente esquecida para abrir o backoffice inteiro a quem
 * visitasse o site. Ignora em vez de rebentar, para um erro de configuração
 * não deitar a aplicação abaixo — mas regista-o, para não passar despercebido.
 */
export function isAuthBypassEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DISABLE_AUTH !== "true") return false;
  if (env.NODE_ENV === "production") {
    console.error("[auth] DISABLE_AUTH=true é ignorado em produção: a autenticação continua obrigatória.");
    return false;
  }
  return true;
}
