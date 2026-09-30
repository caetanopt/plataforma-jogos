import { Prisma } from "@/generated/prisma/client";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";

// Uma rajada na mesma campanha sem o lock (Redis em baixo, espera esgotada)
// esgotava 10 tentativas nos sorteios da roda.
const MAX_SERIALIZATION_RETRIES = 20;

function backoffDelayMs(attempt: number): number {
  const base = Math.min(200, 10 * 2 ** attempt);
  return Math.random() * base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deteta conflitos de escrita em transações serializáveis para permitir
 * repetir a tentativa. O driver adapter (@prisma/adapter-pg, usado pelo
 * Prisma 7) reporta isto como `DriverAdapterError` com causa
 * `{ kind: "TransactionWriteConflict" }`, em vez do antigo código de erro
 * P2034 do motor Rust — por isso a deteção cobre ambas as formas.
 */
export function isSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.message.includes("could not serialize");
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { kind?: string } }).cause;
    if (cause?.kind === "TransactionWriteConflict") return true;
    return (
      error.name === "DriverAdapterError" && error.message.includes("TransactionWriteConflict")
    );
  }
  return false;
}

/** Deadlock (40P01): o Postgres abortou uma das transações; repetir é seguro. */
export function isDeadlock(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return true;
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { originalCode?: string; code?: string } }).cause;
  return cause?.originalCode === "40P01" || cause?.code === "40P01" || /40P01|deadlock detected/i.test(error.message);
}

/** Repete `fn` quando a base de dados a aborta por deadlock (poucas vezes, com espera). */
export async function retryOnDeadlock<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isDeadlock(error) || attempt >= attempts) throw error;
      await sleep(50 + Math.random() * 150 * attempt);
    }
  }
}

/**
 * Corre `fn` dentro de uma transação serializável, repetindo
 * automaticamente (com backoff) quando a BD deteta um conflito de escrita
 * concorrente. Usar sempre que uma operação faz "ler para decidir, depois
 * escrever" contra estado partilhado (stock, contagem de participações) —
 * sem isto, dois pedidos concorrentes podem ambos ler o mesmo estado
 * "antes" e ambos passar uma verificação que devia deixar só um passar.
 */
export async function runSerializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        // Maior do que a espera do pool (ver db/client.ts).
        maxWait: TRANSACTION_MAX_WAIT_MS,
        timeout: 10_000,
      });
    } catch (error) {
      if (isSerializationConflict(error) && attempt < MAX_SERIALIZATION_RETRIES - 1) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Não foi possível concluir a operação após várias tentativas.");
}
