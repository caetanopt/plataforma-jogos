/**
 * Guarda no separador o necessário para retomar a participação depois de
 * recarregar a página: o token de posse, a sessão e, depois do início, o id.
 * Nada de dados pessoais, resultado, prémio ou código — o servidor é a
 * única fonte do que pode ser mostrado.
 *
 * sessionStorage e não localStorage: sobrevive ao F5 e à navegação no
 * separador, morre com ele (quiosque, dispositivo partilhado) e não passa
 * para outros separadores — um segundo separador é uma tentativa nova,
 * sujeita aos limites. Num iframe de outro domínio fica particionado pelo
 * site que o incorpora, mas disponível.
 *
 * Só no browser, sem dependências (fica no bundle do jogo público). Tudo em
 * try/catch: iframes com sandbox e modos privados lançam exceção ao aceder.
 */

export interface StoredParticipation {
  token: string;
  sessionId: string;
  participationId?: string;
  savedAt: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storageKey(campaignId: string, isTestMode: boolean): string {
  return `pj:play:v1:${campaignId}:${isTestMode ? "test" : "live"}`;
}

export function readStoredParticipation(campaignId: string, isTestMode: boolean): StoredParticipation | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(campaignId, isTestMode));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredParticipation>;
    if (typeof value.token !== "string" || !UUID.test(value.token)) return null;
    if (typeof value.sessionId !== "string" || !UUID.test(value.sessionId)) return null;
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > MAX_AGE_MS) return null;
    const participationId =
      typeof value.participationId === "string" && value.participationId.length > 0 && value.participationId.length <= 64
        ? value.participationId
        : undefined;
    return { token: value.token, sessionId: value.sessionId, participationId, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

export function writeStoredParticipation(
  campaignId: string,
  isTestMode: boolean,
  value: Omit<StoredParticipation, "savedAt">,
): void {
  try {
    window.sessionStorage.setItem(storageKey(campaignId, isTestMode), JSON.stringify({ ...value, savedAt: Date.now() }));
  } catch {
    // Sem armazenamento: a participação funciona, só não é retomada.
  }
}

export function clearStoredParticipation(campaignId: string, isTestMode: boolean): void {
  try {
    window.sessionStorage.removeItem(storageKey(campaignId, isTestMode));
  } catch {
    // Idem.
  }
}
