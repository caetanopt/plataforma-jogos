import { Redis } from "ioredis";

declare global {
  var __redis: Redis | undefined;
}

function createRedisClient() {
  return new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
  });
}

export const redis = globalThis.__redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__redis = redis;
}
