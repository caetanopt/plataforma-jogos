import { redis } from "@/server/cache/redis";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Janela fixa simples (contador + TTL) para limitar tentativas por chave
 * (ex.: "login:<email>", "participation:<campaignId>:<ip>").
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
  const redisKey = `ratelimit:${key}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) {
      await redis.expire(redisKey, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
  } catch (error) {
    console.error(`[rate-limit] Redis indisponível, a permitir o pedido (${key}):`, error);
    return { allowed: true, remaining: limit };
  }
}
