import { headers } from "next/headers";

/**
 * Login desligado no site de produção, a pedido da Caetano (9 de outubro de
 * 2026): quem abrir o backoffice no domínio de produção entra sem password,
 * como o utilizador ativo mais antigo (o superadmin semeado).
 *
 * Só vale no deploy de produção do Vercel e só para pedidos ao domínio de
 * produção (`VERCEL_PROJECT_PRODUCTION_URL`). Os previews, o desenvolvimento
 * local e o URL próprio de cada deploy (`<projeto>-<hash>.vercel.app`, que o
 * GitHub lista publicamente) continuam a pedir login. Enquanto estiver ligado,
 * a gestão de utilizadores fica bloqueada: um convite feito agora dava um
 * acesso que sobrevivia ao voltar a ligar o login.
 *
 * Para voltar a exigir login:
 *  1. pôr `false`, publicar no branch de desenvolvimento e no `main`, e
 *     confirmar que o domínio de produção pede login;
 *  2. no Vercel, nunca fazer Instant Rollback nem Promote para um deploy feito
 *     enquanto isto estava `true` (cada deploy congela este valor e voltava a
 *     abrir o domínio). O mais seguro é apagá-los em Deployments;
 *  3. rever na auditoria o que se fez nesse período: tudo aparece em nome do
 *     superadmin.
 */
export const LOGIN_DISABLED_IN_PRODUCTION = true;

type Env = Record<string, string | undefined>;

/**
 * - `production-domain`: `LOGIN_DISABLED_IN_PRODUCTION` num build de produção
 *   a correr no Vercel como deploy de produção. Com só `VERCEL_ENV`, um
 *   `next dev` com as variáveis de produção puxadas do Vercel também abria.
 * - `local`: `DISABLE_AUTH=true`, só em desenvolvimento. Num build de produção
 *   (`next build`/`next start`, incluindo os previews do Vercel) esta flag é
 *   ignorada: bastava uma variável esquecida para abrir o backoffice a quem
 *   visitasse o site. Ignora em vez de rebentar, mas regista-o.
 */
export type AuthBypassMode = "off" | "local" | "production-domain";

export function authBypassMode(
  env: Env = process.env,
  loginDisabledInProduction: boolean = LOGIN_DISABLED_IN_PRODUCTION,
): AuthBypassMode {
  if (
    loginDisabledInProduction &&
    env.VERCEL === "1" &&
    env.VERCEL_ENV === "production" &&
    env.NODE_ENV === "production"
  ) {
    return "production-domain";
  }
  if (env.DISABLE_AUTH !== "true") return "off";
  if (env.NODE_ENV === "production") {
    console.error("[auth] DISABLE_AUTH=true é ignorado em produção: a autenticação continua obrigatória.");
    return "off";
  }
  return "local";
}

/**
 * Se o pedido foi feito ao domínio de produção. Sem esse domínio configurado,
 * nunca: o login continua obrigatório. É o header `Host`, pelo qual o Vercel
 * encaminha o pedido — com outro valor não se chega a este deploy.
 */
export function isProductionDomainHost(host: string | null | undefined, env: Env = process.env): boolean {
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  if (!productionHost || !host) return false;
  return host.trim().toLowerCase() === productionHost;
}

/** Decidido uma vez, no arranque: depende só do ambiente. */
export const AUTH_BYPASS_MODE = authBypassMode();

/**
 * Se este pedido entra sem login. Lê os headers do pedido, o que também
 * mantém dinâmicas as rotas que o usam (como o `auth()` real, que lê cookies).
 */
export async function isLoginBypassed(): Promise<boolean> {
  if (AUTH_BYPASS_MODE === "off") return false;
  const requestHeaders = await headers();
  if (AUTH_BYPASS_MODE === "local") return true;
  return isProductionDomainHost(requestHeaders.get("host"));
}
