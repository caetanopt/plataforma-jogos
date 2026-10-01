/**
 * Identidade declarada no formulário de leads de uma participação.
 *
 * Fica gravada na própria participação (e não no Participant, partilhado por
 * quem usa o mesmo browser) e serve a lista de leads, a exportação, a
 * pesquisa e o controlo de duplicados por e-mail/telefone.
 */

export interface LeadIdentity {
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface IdentityField {
  type: string;
  internalKey: string;
  order: number;
}

/** E-mails comparam-se sem maiúsculas nem espaços: "Ana@X.pt " é "ana@x.pt". */
export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * Telefones comparam-se só pelos dígitos: "912 345 678", "912-345-678" e
 * "912345678" são o mesmo número, e antes contavam como três pessoas no
 * controlo de duplicados. Um "+" antes do primeiro dígito, ou o prefixo
 * internacional "00", dão a forma "+351912345678". Não se adivinha o
 * indicativo: "912345678" e "+351912345678" continuam diferentes.
 *
 * A mesma regra está em SQL na migração que normalizou os telefones já
 * gravados — as duas têm de coincidir.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (/[0-9+]/.exec(value)?.[0] === "+") return `+${digits}`;
  if (digits.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  return digits;
}

/** Um número nacional português: 9 dígitos, a começar por 2 a 9. */
const PORTUGUESE_NATIONAL = /^[2-9]\d{8}$/;
const PORTUGAL_PREFIX = "+351";

export interface PhoneMatchForms {
  /** Na forma de normalizePhone: como estão nas colunas de identidade. */
  normalized: string[];
  /**
   * Só os dígitos, com "+" se o tinha antes do primeiro dígito: como uma
   * resposta ao formulário ou um dado antigo (não normalizados) se comparam.
   * "+351…" pode estar escrito "+351 …" ou "00351 …".
   */
  written: string[];
}

/**
 * As formas do mesmo telefone num pedido de um titular (§24), a partir de
 * um número já normalizado (normalizePhone). Um número português é o mesmo
 * com ou sem o indicativo: "912345678", "912 345 678", "+351 912 345 678" e
 * "00351912345678" encontram-se uns aos outros. Os outros países comparam-se
 * pela forma normalizada, sem adivinhar indicativos.
 *
 * A única regra de equivalência: a procura, os dados antigos de
 * participante e a anonimização usam-na todas (queries.ts).
 */
export function phoneMatchForms(phone: string): PhoneMatchForms {
  const normalized = PORTUGUESE_NATIONAL.test(phone)
    ? [phone, `${PORTUGAL_PREFIX}${phone}`]
    : phone.startsWith(PORTUGAL_PREFIX) && PORTUGUESE_NATIONAL.test(phone.slice(PORTUGAL_PREFIX.length))
      ? [phone, phone.slice(PORTUGAL_PREFIX.length)]
      : [phone];
  return {
    normalized,
    written: normalized.flatMap((form) => (form.startsWith("+") ? [form, `00${form.slice(1)}`] : [form])),
  };
}

/** A forma escrita de um valor (ver PhoneMatchForms.written): a mesma regra do SQL. */
export function writtenPhoneForm(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return /[0-9+]/.exec(value)?.[0] === "+" ? `+${digits}` : digits;
}

/** Entre 6 e 15 dígitos (o máximo do E.164). */
export function isPlausiblePhone(value: string | null | undefined): boolean {
  const normalized = normalizePhone(value);
  if (!normalized) return false;
  const digits = normalized.replace("+", "").length;
  return digits >= 6 && digits <= 15;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Por tipo de campo usa-se o primeiro pela ordem do formulário — a mesma
 * regra do preenchimento feito na migração, para que os dados antigos e os
 * novos sejam comparáveis.
 */
export function extractLeadIdentity(
  fields: readonly IdentityField[],
  values: Record<string, string | undefined>,
): LeadIdentity {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  const valueOf = (types: readonly string[]) => {
    const field = ordered.find((f) => types.includes(f.type));
    return field ? values[field.internalKey] : undefined;
  };

  return {
    email: normalizeEmail(valueOf(["EMAIL"])),
    phone: normalizePhone(valueOf(["PHONE"])),
    firstName: clean(valueOf(["FIRST_NAME", "FULL_NAME"])),
    lastName: clean(valueOf(["LAST_NAME"])),
  };
}
