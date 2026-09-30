import { randomUUID } from "node:crypto";
import { redis } from "@/server/cache/redis";
// Não de rate-limit: os testes substituem esse módulo, e o lock tem de falhar
// aberto também aí.
import { describeRedisError } from "@/lib/security/redis-errors";

// Só apaga o lock se ainda for nosso (pode ter expirado e sido tomado por outro).
const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LockOptions {
  /** Validade do lock, caso quem o tem morra a meio. */
  ttlMs?: number;
  /** Quanto tempo se espera por ele antes de seguir sem ele. */
  waitMs?: number;
}

/**
 * Exclusão mútua por chave (Redis, SET NX PX), para operações que já estão
 * corretas sozinhas mas que, em rajada, se atropelam.
 *
 * O caso é o sorteio da roda: a transação serializável garante que o stock
 * nunca é ultrapassado, mas dez rotações ao mesmo tempo na mesma campanha (um
 * QR code num ecrã, num evento) entram em conflito entre si e esgotam as
 * tentativas — alguém recebia um erro. Com o lock, as rotações da mesma
 * campanha passam uma de cada vez.
 *
 * Falha aberta: sem Redis, ou se esperar demasiado, corre sem o lock — a
 * transação continua a garantir a correção, só volta a haver conflitos.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  // Acima do tempo máximo da transação (10 s, transaction-retry.ts): o lock
  // não pode expirar enquanto quem o tem ainda está a trabalhar.
  const ttlMs = options.ttlMs ?? 20_000;
  const waitMs = options.waitMs ?? 5_000;
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  let acquired = false;

  try {
    for (;;) {
      if ((await redis.set(key, token, "PX", ttlMs, "NX")) === "OK") {
        acquired = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await sleep(15 + Math.random() * 20);
    }
  } catch (error) {
    console.error(`[lock] Redis indisponível, a continuar sem lock: ${describeRedisError(error)}`);
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      await redis.eval(RELEASE_SCRIPT, 1, key, token).catch((error: unknown) => {
        console.error(`[lock] Falha ao libertar o lock: ${describeRedisError(error)}`);
      });
    }
  }
}
