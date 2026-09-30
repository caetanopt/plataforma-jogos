/**
 * Descrição de um erro do Redis sem o objeto: o ioredis anexa ao erro o
 * comando e os argumentos (`command.args`) — a chave do rate limit e, numa
 * falha de autenticação, a password do Redis. Fica o nome e a primeira
 * palavra da mensagem, que nos erros do Redis é o código (WRONGPASS, OOM,
 * READONLY...).
 */
export function describeRedisError(error: unknown): string {
  const { name, message } = (error ?? {}) as { name?: string; message?: string };
  const code = String(message ?? "").split(" ")[0] ?? "";
  return `${name ?? "Error"}${code ? ` ${code}` : ""}`;
}
