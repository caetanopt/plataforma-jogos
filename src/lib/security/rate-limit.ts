import { redis } from "@/server/cache/redis";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Janela fixa simples (contador + TTL) para limitar tentativas por chave
 * (ex.: "login:<email>", "participation:<campaignId>:<ip>").
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
