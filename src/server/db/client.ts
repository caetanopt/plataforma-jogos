import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Pool com limites (passo 7). Com os valores por omissão do pg, um pedido
 * esperava por uma ligação livre sem fim quando o pool esgotava, e uma query
 * presa ocupava a ligação para sempre. Agora a espera tem um máximo e cada
 * instrução também (a eliminação de uma campanha grande é a mais longa).
 */
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: numberFromEnv("DATABASE_POOL_MAX", 10),
    connectionTimeoutMillis: numberFromEnv("DATABASE_CONNECTION_TIMEOUT_MS", 10_000),
    idleTimeoutMillis: 30_000,
    statement_timeout: numberFromEnv("DATABASE_STATEMENT_TIMEOUT_MS", 60_000),
  });
  return new PrismaClient({ adapter });
}

// Um só cliente por processo, também em produção: o build pode carregar este
// módulo com mais de um id, e cada um abria o seu pool.
export const prisma = globalThis.__prisma ?? createPrismaClient();
globalThis.__prisma = prisma;
