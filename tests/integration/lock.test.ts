import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { redis } from "@/server/cache/redis";
import { withLock } from "@/server/cache/lock";

/**
 * O lock por campanha à volta do sorteio da roda (src/server/cache/lock.ts),
 * contra o Redis real.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockKey(): string {
  return `test:lock:${randomUUID()}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await redis.quit();
});

describe("withLock", () => {
  it("com a mesma chave, as operações correm uma de cada vez", async () => {
    const key = lockKey();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];

    await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        withLock(key, async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await sleep(20);
          order.push(index);
          running -= 1;
        }),
      ),
    );

    expect(maxRunning).toBe(1);
    expect(order).toHaveLength(5);
    // Liberta no fim.
    expect(await redis.exists(key)).toBe(0);
  });

  it("chaves diferentes não esperam umas pelas outras", async () => {
    let running = 0;
    let maxRunning = 0;

    await Promise.all(
      [lockKey(), lockKey()].map((key) =>
        withLock(key, async () => {
          running += 1;
          maxRunning = Math.max(maxRunning, running);
          await sleep(30);
          running -= 1;
        }),
      ),
    );

    expect(maxRunning).toBe(2);
  });

  it("devolve o resultado e liberta o lock quando a operação falha", async () => {
    const key = lockKey();

    await expect(withLock(key, async () => 42)).resolves.toBe(42);
    await expect(
      withLock(key, async () => {
        throw new Error("falhou");
      }),
    ).rejects.toThrow("falhou");
    expect(await redis.exists(key)).toBe(0);
  });

  it("depois de esperar o tempo máximo, corre sem o lock", async () => {
    const key = lockKey();
    await redis.set(key, "de outro", "PX", 5_000);

    const started = Date.now();
    const result = await withLock(key, async () => "correu", { waitMs: 100 });

    expect(result).toBe("correu");
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    // O lock de outro não é apagado por quem não o tinha.
    expect(await redis.get(key)).toBe("de outro");
    await redis.del(key);
  });

  it("não apaga o lock de outro quando o seu já expirou", async () => {
    const key = lockKey();

    const first = withLock(
      key,
      async () => {
        await sleep(150);
      },
      { ttlMs: 50 },
    );
    await sleep(80);
    // O primeiro expirou: o segundo fica com o lock e ainda o tem quando o
    // primeiro termina.
    let secondHeldAfterFirst = 0;
    const second = withLock(key, async () => {
      await first;
      secondHeldAfterFirst = await redis.exists(key);
    });

    await Promise.all([first, second]);
    expect(secondHeldAfterFirst).toBe(1);
    expect(await redis.exists(key)).toBe(0);
  });

  it("falha aberto: sem Redis, a operação corre na mesma", async () => {
    const error = Object.assign(new Error("ECONNREFUSED 127.0.0.1:6379"), {
      command: { name: "set", args: ["lock:segredo", "token"] },
    });
    vi.spyOn(redis, "set").mockRejectedValue(error);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(withLock(lockKey(), async () => "correu")).resolves.toBe("correu");
    // Só o nome e o código do erro, nunca os argumentos do comando.
    expect(logged).toHaveBeenCalledWith("[lock] Redis indisponível, a continuar sem lock: Error ECONNREFUSED");
  });
});
