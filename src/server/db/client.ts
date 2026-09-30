import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Espera máxima por uma ligação livre do pool. */
export const DATABASE_CONNECTION_TIMEOUT_MS = numberFromEnv("DATABASE_CONNECTION_TIMEOUT_MS", 10_000);

/**
 * Quanto uma transação espera para começar. Tem de ser MAIOR do que a espera
 * do pool: se o Prisma desiste primeiro (P2028), o pedido continua na fila do
 * pool e, quando a ligação chega, o adapter abre a transação (BEGIN) e
 * devolve-a ao pool sem ROLLBACK. A ligação fica "idle in transaction" e as
 * escritas seguintes de outros pedidos que a apanham nunca são confirmadas:
 * respondem "gravado" e perdem-se. Com o pool a desistir primeiro, a
 * transação falha antes de chegar a abrir.
 */
export const TRANSACTION_MAX_WAIT_MS = DATABASE_CONNECTION_TIMEOUT_MS + 5_000;

/**
 * Pool com limites (passo 7). Com os valores por omissão do pg, um pedido
 * esperava por uma ligação livre sem fim quando o pool esgotava. Agora a
 * espera tem um máximo.
 *
 * O tempo máximo de cada instrução não se define aqui: o pg mandava-o nos
 * parâmetros de arranque da ligação, que o PgBouncer (o pooler da Neon, URL
 * "-pooler") recusa — todas as ligações falhavam. Define-se na base de dados
 * (README, "Antes de fazer deploy").
 */
export function createPrismaClient(
  options: { connectionString?: string; max?: number; connectionTimeoutMs?: number } = {},
) {
  const connectionTimeoutMs = options.connectionTimeoutMs ?? DATABASE_CONNECTION_TIMEOUT_MS;
  const adapter = new PrismaPg({
    connectionString: options.connectionString ?? process.env.DATABASE_URL,
    max: options.max ?? numberFromEnv("DATABASE_POOL_MAX", 10),
    connectionTimeoutMillis: connectionTimeoutMs,
    idleTimeoutMillis: 30_000,
  });
  // Também para as transações em lote (`$transaction([...])`), que usavam os
  // 2 s do Prisma.
  return new PrismaClient({ adapter, transactionOptions: { maxWait: connectionTimeoutMs + 5_000, timeout: 5_000 } });
}

// Um só cliente por processo, também em produção: o build pode carregar este
// módulo com mais de um id, e cada um abria o seu pool.
export const prisma = globalThis.__prisma ?? createPrismaClient();
globalThis.__prisma = prisma;
