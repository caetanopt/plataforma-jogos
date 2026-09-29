import { NextResponse } from "next/server";

/** Cookies do Auth.js (incluindo as variantes com prefixo e em pedaços: `.0`, `.1`). */
const AUTH_COOKIE_PREFIXES = ["authjs.", "__Secure-authjs.", "__Host-authjs."];

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  // Sem Origin (alguns browsers em POST de formulário da mesma origem) aceita-se:
  // terminar a própria sessão não dá nada a um atacante além de um incómodo.
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }

  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });

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
