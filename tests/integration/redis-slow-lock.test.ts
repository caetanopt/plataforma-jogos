import net from "node:net";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Redis lento (passo 7): um SET NX que excede o `commandTimeout` não é
 * cancelado, chega ao Redis mais tarde e cria o lock com o nosso token.
 * Antes ninguém o libertava e, durante o TTL (20 s), cada rotação da mesma
 * campanha esperava os 5 s inteiros antes de seguir sem lock.
 *
 * Um proxy à frente do Redis local atrasa o que o cliente manda enquanto
 * `slow` estiver ligado.
 */

const PROXY_PORT = 6393;
const REDIS_PORT = 6379;

vi.hoisted(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:6393";
  globalThis.__redis = undefined;
});

const proxyState = { slow: false };
const sockets = new Set<net.Socket>();
const proxy = net.createServer((client) => {
  const upstream = net.connect(REDIS_PORT, "127.0.0.1");
  sockets.add(client);
  sockets.add(upstream);
  client.on("error", () => undefined);
  upstream.on("error", () => undefined);
  // Mantém a ordem dos pedidos: cada pedaço sai depois do anterior.
  let queue = Promise.resolve();
  client.on("data", (chunk) => {
    const delay = proxyState.slow ? 1_500 : 0;
    queue = queue.then(() => new Promise<void>((resolve) => setTimeout(resolve, delay))).then(() => {
      upstream.write(chunk);
    });
  });
  upstream.on("data", (chunk) => client.write(chunk));
});
await new Promise<void>((resolve) => proxy.listen(PROXY_PORT, "127.0.0.1", resolve));

const { withLock } = await import("@/server/cache/lock");
const { redis } = await import("@/server/cache/redis");
const direct = new Redis(`redis://127.0.0.1:${REDIS_PORT}`);

afterAll(async () => {
  redis.disconnect();
  direct.disconnect();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => proxy.close(resolve));
});

describe("Redis lento", () => {
  it("um SET que excedeu o tempo não deixa o lock preso", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const key = `lock:lento:${randomUUID()}`;
    await redis.ping();

    proxyState.slow = true;
    const started = Date.now();
    expect(await withLock(key, async () => "correu")).toBe("correu");
    // Seguiu sem lock ao fim do commandTimeout.
    expect(Date.now() - started).toBeLessThan(2_500);

    // O SET atrasado e a libertação chegam ao Redis por esta ordem.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    proxyState.slow = false;
    await redis.ping();
    expect(await direct.exists(key)).toBe(0);

    // Com o Redis de volta, o lock seguinte é imediato.
    const next = Date.now();
    expect(await withLock(key, async () => "outra vez")).toBe("outra vez");
    expect(Date.now() - next).toBeLessThan(1_000);
  }, 15_000);
});
