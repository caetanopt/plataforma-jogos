import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, DATABASE_CONNECTION_TIMEOUT_MS, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";

/**
 * Com o pool cheio, uma transação que não consegue ligação falha — e não
 * deixa uma ligação "idle in transaction" para trás. Quando o Prisma
 * desistia antes do pool (maxWait menor do que a espera do pool), a ligação
 * chegava depois, o adapter abria a transação e devolvia-a ao pool aberta:
 * as escritas seguintes nessa ligação respondiam "gravado" e perdiam-se.
 */

const applicationName = `pool-leak-${randomUUID().slice(0, 8)}`;
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("application_name", applicationName);

const probe = new Client({ connectionString: process.env.DATABASE_URL });
await probe.connect();
const client = createPrismaClient({ connectionString: url.toString(), max: 1, connectionTimeoutMs: 500 });

afterAll(async () => {
  await client.$disconnect();
  await probe.end();
});

async function openTransactions(): Promise<number> {
  const { rows } = await probe.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pg_stat_activity WHERE application_name = $1 AND state LIKE 'idle in transaction%'`,
    [applicationName],
  );
  return Number(rows[0]!.count);
}

describe("pool cheio e transações", () => {
  it("a espera da transação é sempre maior do que a do pool", () => {
    expect(TRANSACTION_MAX_WAIT_MS).toBeGreaterThan(DATABASE_CONNECTION_TIMEOUT_MS);
  });

  it("uma transação sem ligação falha sem deixar uma transação aberta, e as escritas seguintes ficam", async () => {
    // A única ligação fica ocupada 1,5 s; o pool desiste aos 0,5 s.
    // As queries do Prisma só correm quando alguém espera por elas.
    const hold = client.$queryRaw`SELECT pg_sleep(1.5)::text`.then(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const interactive = client.$transaction(async (tx) => tx.$queryRaw`SELECT 1`).then(
      () => "ok",
      () => "falhou",
    );
    const batch = client.$transaction([client.$queryRaw`SELECT 1`]).then(
      () => "ok",
      () => "falhou",
    );
    expect(await interactive).toBe("falhou");
    expect(await batch).toBe("falhou");
    await hold;
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await openTransactions()).toBe(0);

    // Uma escrita a seguir, na mesma (e única) ligação, fica gravada.
    const marker = `leak-${randomUUID()}`;
    await client.$executeRaw`CREATE TEMP TABLE IF NOT EXISTS pool_leak_probe (v text)`;
    await client.$executeRaw`INSERT INTO pool_leak_probe (v) VALUES (${marker})`;
    const [{ count }] = await client.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM pool_leak_probe WHERE v = ${marker}`;
    expect(count).toBe(1);
    expect(await openTransactions()).toBe(0);
  });
});
