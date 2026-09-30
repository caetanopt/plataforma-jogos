import net from "node:net";
import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * Redis que não responde (passo 7): o rate limit e o lock falham abertos, e
 * depressa. O pior caso é o de um Redis que aceita a ligação e não responde
 * (sobrecarregado, rede presa): antes, sem `commandTimeout`, cada comando
 * ficava à espera na fila sem fim, e com ele o login e o jogo público.
 */

vi.hoisted(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:6391";
  globalThis.__redis = undefined;
});

// Aceita ligações e nunca responde.
const sockets = new Set<net.Socket>();
const silent = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("error", () => undefined);
});
await new Promise<void>((resolve) => silent.listen(6391, "127.0.0.1", resolve));

const { checkRateLimit } = await import("@/lib/security/rate-limit");
const { withLock } = await import("@/server/cache/lock");
const { redis } = await import("@/server/cache/redis");

afterAll(async () => {
  redis.disconnect();
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => silent.close(resolve));
});

describe("Redis que não responde", () => {
  it("o rate limit deixa passar em menos de 2,5 s", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = Date.now();

    const result = await checkRateLimit("login:teste@example.pt", 5, 60);

    expect(result.allowed).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("o lock corre a operação sem ele, também em menos de 2,5 s", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const started = Date.now();

    expect(await withLock("lock:teste", async () => "correu")).toBe("correu");
    expect(Date.now() - started).toBeLessThan(2_500);
  });
});
