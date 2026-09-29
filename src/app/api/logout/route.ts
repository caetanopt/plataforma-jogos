import { NextResponse } from "next/server";

/** Cookies do Auth.js (incluindo as variantes com prefixo e em pedaços: `.0`, `.1`). */
const AUTH_COOKIE_PREFIXES = ["authjs.", "__Secure-authjs.", "__Host-authjs."];

/**
 * Compara o Origin com o host que o browser usou (x-forwarded-host atrás de
 * um proxy, senão Host) — a mesma regra da verificação CSRF das server
 * actions do Next. Não com request.url: com `next start` atrás de nginx ou
 * aberto por IP, request.url é http://localhost:3000 e o "Sair" respondia 403.
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Sem Origin (alguns browsers em POST de formulário da mesma origem) aceita-se:
  // terminar a própria sessão não dá nada a um atacante além de um incómodo.
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  // Location relativo: o browser resolve-o no host que usou (request.url pode
  // ser o host interno do servidor).
  const response = new NextResponse(null, { status: 303, headers: { Location: "/login" } });

  const present = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter((name) => AUTH_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)));

  const names = new Set([
    ...(present ?? []),
    "authjs.session-token",
    "__Secure-authjs.session-token",
    "authjs.callback-url",
    "__Secure-authjs.callback-url",
    "authjs.csrf-token",
    "__Host-authjs.csrf-token",
  ]);

  for (const name of names) {
    // Um browser rejeita o Set-Cookie de um cookie __Secure-/__Host- sem o
    // atributo Secure: sem isto, em produção (HTTPS) o cookie de sessão não
    // era apagado e o utilizador continuava autenticado depois de "sair".
    const secure = name.startsWith("__Secure-") || name.startsWith("__Host-");
    response.cookies.set(name, "", {
      expires: new Date(0),
      maxAge: 0,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure,
    });
  }
  return response;
}
