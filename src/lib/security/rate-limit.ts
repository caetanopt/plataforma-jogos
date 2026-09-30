import { redis } from "@/server/cache/redis";
import { rateLimitRedisKey } from "@/lib/security/rate-limit-key";
import { describeRedisError } from "@/lib/security/redis-errors";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Janela fixa simples (contador + TTL) para limitar tentativas por chave
 * (ex.: "login:<email>", "participation:<campaignId>:<ip>"). A chave é
 * guardada com HMAC (ver rateLimitRedisKey).
 *
 * Falha aberta (permite o pedido) se o Redis estiver indisponível — uma
 * falha do Redis nunca deve derrubar o login, o reset de password ou a
 * participação pública nos jogos, que são o núcleo do produto.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = rateLimitRedisKey(key);
  try {
    // Atómico: cria a chave com TTL (só se não existir) e incrementa na mesma
    // transação. Com INCR e EXPIRE em pedidos separados, uma falha entre os
    // dois deixava a chave sem TTL — e esse e-mail ou IP ficava bloqueado
    // para sempre.
    const results = await redis.multi().set(redisKey, "0", "EX", windowSeconds, "NX").incr(redisKey).exec();
    const incr = results?.[1];
    if (!incr || incr[0]) throw incr?.[0] ?? new Error("Transação do Redis sem resultado");
    const count = Number(incr[1]);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (error) {
    const kind = key.split(":")[0];
    console.error(`[rate-limit] Redis indisponível, a permitir o pedido (${kind}): ${describeRedisError(error)}`);
    return { allowed: true, remaining: limit };
  }
}
