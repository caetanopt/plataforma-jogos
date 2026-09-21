/**
 * Saudação dependente da hora do dia.
 *
 * É calculada no servidor (a página inicial é um Server Component), por isso
 * precisa de um fuso explícito: o relógio do processo não é o do utilizador e
 * uma saudação calculada no cliente causaria mismatch de hidratação. A
 * plataforma é operada pela Caetano em Portugal, logo o fuso de referência é
 * Europe/Lisbon, mas fica parametrizável para quando existir fuso por
 * organização.
 */
const DEFAULT_TIME_ZONE = "Europe/Lisbon";

export function getGreeting(now: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const hour = Number(
    new Intl.DateTimeFormat("pt-PT", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(now),
  );

  if (hour < 6) return "Boa noite";
  if (hour < 13) return "Bom dia";
  if (hour < 20) return "Boa tarde";
  return "Boa noite";
}

/**
 * Primeiro nome a usar na saudação.
 *
 * `context.userName` é `user.name ?? user.email ?? ""`, por isso pode ser um
 * e-mail. Dado pessoal não vai para o cabeçalho da página inicial: nesse caso
 * devolve `null` e a saudação fica sem nome.
 */
export function getGreetingName(userName: string): string | null {
  const trimmed = userName.trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed.split(/\s+/)[0];
}
