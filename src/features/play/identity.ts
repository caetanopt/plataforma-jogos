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
    phone: clean(valueOf(["PHONE"])),
    firstName: clean(valueOf(["FIRST_NAME", "FULL_NAME"])),
    lastName: clean(valueOf(["LAST_NAME"])),
  };
}
