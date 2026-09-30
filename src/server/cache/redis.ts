import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
}

/**
 * Cliente Redis (rate limit e locks). Tudo o que o usa falha aberto, por isso
 * o importante é falhar depressa: antes, com o Redis em baixo, cada comando
 * esperava na fila offline e em 3 tentativas — até dezenas de segundos por
 * pedido, no login e no jogo público.
 *
 * - `commandTimeout` conta desde o envio, também o tempo na fila offline: um
 *   comando nunca espera mais do que isso;
 * - a fila fica ligada para os primeiros comandos, enquanto a ligação abre;
 * - uma só nova tentativa por comando, e religação com espera crescente.
 */
function createRedisClient() {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 1_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
  });
  // Sem listener, o ioredis imprime "Unhandled error event" com a stack a cada
  // tentativa de ligação. Aqui fica só o nome e o código — nunca o erro
  // inteiro, que pode trazer o comando e os argumentos (ver rate-limit.ts).
  client.on("error", (error: Error & { code?: string }) => {
    console.error(`[redis] ${error.name}${error.code ? ` ${error.code}` : ""}`);
  });
  return client;
}

// Um só cliente por processo, também em produção (ver db/client.ts).
export const redis = globalThis.__redis ?? createRedisClient();
globalThis.__redis = redis;
