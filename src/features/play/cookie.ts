import { cookies, headers } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE_NAME = "pj_vid";
/** Nome anterior (Lax, sem Partitioned). Lido uma última vez para manter os limites. */
const LEGACY_COOKIE_NAME = "pj_visitor";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VisitorCookieOptions {
  httpOnly: true;
  path: "/";
  maxAge: number;
  sameSite: "none" | "lax";
  secure: boolean;
  partitioned: boolean;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^127(\.\d{1,3}){3}$/.test(hostname) ||
    hostname === "[::1]"
  );
}

/**
 * Atributos do cookie de visitante.
 *
 * O jogo é incorporado noutros sites (iframe, §19). Num iframe de outro
 * domínio, um cookie `SameSite=Lax` não é enviado nem gravado: cada início
 * criava um visitante novo e o limite por cookie deixava de funcionar. Em
 * contexto seguro o cookie passa a `SameSite=None; Secure; Partitioned`
 * (CHIPS): é aceite mesmo com cookies de terceiros bloqueados e fica ligado
 * ao site que incorpora — não serve para seguir a pessoa entre sites (§24).
 * Em http numa rede local (um telemóvel a testar em http://192.168...), o
 * browser recusa `Secure`: fica o comportamento anterior.
 */
export function visitorCookieOptions(origin: string | null, forwardedProto: string | null, nodeEnv: string | undefined): VisitorCookieOptions {
  let secureContext = nodeEnv === "production";
  if (origin) {
    try {
      const url = new URL(origin);
      secureContext = url.protocol === "https:" || isLoopbackHost(url.hostname);
    } catch {
      // Origin inválido: fica a decisão pelo ambiente.
    }
  } else if (forwardedProto) {
    secureContext = forwardedProto.split(",")[0]?.trim() === "https";
  }

  return secureContext
    ? { httpOnly: true, path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "none", secure: true, partitioned: true }
    : { httpOnly: true, path: "/", maxAge: ONE_YEAR_SECONDS, sameSite: "lax", secure: false, partitioned: false };
}

/**
 * Identificador anónimo de visitante, usado para o limite de participação e
 * para a estratégia de duplicados "Cookie" (secções 11, 16). Não é PII.
 *
 * Só aceita um UUID: o valor vai para `Participant.cookieId` (único por
 * organização) e antes entrava qualquer texto.
 */
export async function getOrCreateVisitorCookieId(): Promise<string> {
  const store = await cookies();
  const current = store.get(COOKIE_NAME)?.value;
  if (current && UUID.test(current)) return current;

  // Mudança de nome, e não só de atributos: o browser guarda a cópia
  // particionada e a antiga como cookies distintos com o mesmo nome, e uma
  // resposta não consegue apagar uma e gravar a outra. O valor antigo é
  // reaproveitado para quem já tinha participado continuar a contar.
  const legacy = store.get(LEGACY_COOKIE_NAME)?.value;
  const id = legacy && UUID.test(legacy) ? legacy : randomUUID();

  const requestHeaders = await headers();
  store.set(
    COOKIE_NAME,
    id,
    visitorCookieOptions(requestHeaders.get("origin"), requestHeaders.get("x-forwarded-proto"), process.env.NODE_ENV),
  );
  if (legacy) store.delete(LEGACY_COOKIE_NAME);
  return id;
}
