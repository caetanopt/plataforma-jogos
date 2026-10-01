/**
 * Compara o Origin com o host que o browser usou (x-forwarded-host atrás de
 * um proxy, senão Host) — a mesma regra da verificação CSRF das server
 * actions do Next. Não com request.url: com `next start` atrás de nginx ou
 * aberto por IP, request.url é http://localhost:3000 e os pedidos da própria
 * página eram recusados.
 *
 * `allowMissingOrigin`: alguns browsers não mandam o Origin num POST de
 * formulário da mesma origem. Aceitar só onde o pedido não dá nada a um
 * atacante (terminar a sessão); um `fetch` POST manda-o sempre.
 */
export function isSameOriginRequest(request: Request, options: { allowMissingOrigin?: boolean } = {}): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return options.allowMissingOrigin === true;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host");
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}
