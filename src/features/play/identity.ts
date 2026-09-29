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
