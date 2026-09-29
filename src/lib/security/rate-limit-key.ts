import { createHmac } from "node:crypto";

/**
 * Chave Redis de um rate limit: `ratelimit:<tipo>:<HMAC do identificador>`.
 *
 * Os identificadores são e-mails, IPs, cookies de visitante e o próprio
 * token de reposição de password. Em claro, ficavam como nomes de chaves no
 * Redis, nos snapshots/backups e nos logs (o ioredis anexa a chave aos
 * erros). O tipo (login, password-reset, ...) fica legível para diagnóstico.
 *
 * Módulo separado de rate-limit.ts para poder ser usado sem abrir a ligação
 * ao Redis (ex.: na suite e2e).
 */
export function rateLimitRedisKey(key: string, secret: string = process.env.AUTH_SECRET ?? ""): string {
  const separator = key.indexOf(":");
  const kind = separator === -1 ? key : key.slice(0, separator);
  const identifier = separator === -1 ? "" : key.slice(separator + 1);
  const digest = createHmac("sha256", secret).update(identifier).digest("base64url");
  return `ratelimit:${kind}:${digest}`;
}
