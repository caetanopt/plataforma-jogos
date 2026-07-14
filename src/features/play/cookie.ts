import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE_NAME = "pj_visitor";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Identificador anónimo de visitante, usado para o limite de participação e
 * para a estratégia de duplicados "Cookie" (secções 11, 16). Não é PII.
 */
export async function getOrCreateVisitorCookieId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const id = randomUUID();
  store.set(COOKIE_NAME, id, {
    maxAge: ONE_YEAR_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return id;
}
