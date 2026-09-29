import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
}

function createRedisClient() {
  const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
  });
  // Sem listener, o ioredis imprime "Unhandled error event" com a stack a cada
  // tentativa de ligação. Aqui fica só o nome e o código — nunca o erro
  // inteiro, que pode trazer o comando e os argumentos (ver rate-limit.ts).
  client.on("error", (error: Error & { code?: string }) => {
    console.error(`[redis] ${error.name}${error.code ? ` ${error.code}` : ""}`);
  });
  return client;
}

export const redis = globalThis.__redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis = redis;
}
