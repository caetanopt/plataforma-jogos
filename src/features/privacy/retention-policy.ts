/**
 * Prazo de conservação das leads (§24): quanto tempo se guardam os dados
 * pessoais de cada participação antes de serem anonimizados.
 *
 * - A organização define um prazo por omissão, em dias (ou nenhum).
 * - Uma campanha pode ter o seu: em dias, ou uma data a partir da qual tudo
 *   é anonimizado. Sem prazo próprio, vale o da organização.
 *
 * Os dias contam-se a partir de cada participação: com 90 dias, uma lead de
 * 1 de março é anonimizada a 30 de maio, e as seguintes vão saindo à medida
 * que chegam ao prazo — não de uma só vez no fim da campanha.
 *
 * Funções puras: o job diário, os avisos e o editor usam as mesmas contas.
 */

export const RETENTION_DAY_OPTIONS = [30, 90, 180, 365] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A anonimização automática nunca toca numa participação com menos de um
 * dia: quem está a jogar, ou a meio do formulário, acaba primeiro. Só conta
 * para um prazo em data (os prazos em dias são todos maiores).
 */
export const MIN_PARTICIPATION_AGE_MS = DAY_MS;

/** Com quanta antecedência o backoffice avisa das anonimizações. */
export const RETENTION_WARNING_DAYS = 7;

export type EffectiveRetention =
  | { kind: "none" }
  | { kind: "days"; days: number; source: "campaign" | "organization" }
  | { kind: "until"; until: Date };

export interface RetentionSettings {
  campaign: { dataRetentionDays: number | null; dataRetentionUntil: Date | null };
  organizationDays: number | null;
}

function validDays(days: number | null): days is number {
  return days !== null && Number.isInteger(days) && days > 0;
}

export function effectiveRetention({ campaign, organizationDays }: RetentionSettings): EffectiveRetention {
  if (campaign.dataRetentionUntil) return { kind: "until", until: campaign.dataRetentionUntil };
  if (validDays(campaign.dataRetentionDays)) return { kind: "days", days: campaign.dataRetentionDays, source: "campaign" };
  if (validDays(organizationDays)) return { kind: "days", days: organizationDays, source: "organization" };
  return { kind: "none" };
}

/**
 * As participações criadas antes deste instante já passaram o prazo em
 * `now` (e têm pelo menos um dia). Null: nenhuma passou.
 */
export function retentionCutoff(retention: EffectiveRetention, now: Date): Date | null {
  const youngest = now.getTime() - MIN_PARTICIPATION_AGE_MS;
  if (retention.kind === "days") return new Date(Math.min(now.getTime() - retention.days * DAY_MS, youngest));
  if (retention.kind === "until") return retention.until.getTime() <= now.getTime() ? new Date(youngest) : null;
  return null;
}

/** Quando uma participação criada em `createdAt` vai ser anonimizada. */
export function anonymizationDate(retention: EffectiveRetention, createdAt: Date): Date | null {
  const oldEnough = createdAt.getTime() + MIN_PARTICIPATION_AGE_MS;
  if (retention.kind === "days") return new Date(Math.max(createdAt.getTime() + retention.days * DAY_MS, oldEnough));
  if (retention.kind === "until") return new Date(Math.max(retention.until.getTime(), oldEnough));
  return null;
}

export function describeRetention(retention: EffectiveRetention, timeZone: string): string {
  if (retention.kind === "none") return "Sem prazo: os dados ficam até serem anonimizados à mão.";
  if (retention.kind === "days") {
    const origin = retention.source === "organization" ? " (prazo da organização)" : "";
    return `${retention.days} dias depois de cada participação${origin}.`;
  }
  const date = new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone }).format(retention.until);
  return `A partir de ${date}, todas as participações.`;
}
