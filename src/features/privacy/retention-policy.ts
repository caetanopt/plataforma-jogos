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
 * Um prazo novo ou alterado só começa a anonimizar RETENTION_WARNING_DAYS
 * depois da alteração: escolher "30 dias" numa organização com leads de um
 * ano não as apaga na madrugada seguinte, sem aviso. Os avisos aparecem logo.
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

/**
 * `startsAt`: antes deste instante o prazo ainda não anonimiza nada (7 dias
 * depois da última alteração). Null: sem alteração registada.
 */
export type EffectiveRetention =
  | { kind: "none" }
  | { kind: "days"; days: number; source: "campaign" | "organization"; startsAt: Date | null }
  | { kind: "until"; until: Date; startsAt: Date | null };

export interface RetentionSettings {
  campaign: {
    dataRetentionDays: number | null;
    dataRetentionUntil: Date | null;
    dataRetentionChangedAt?: Date | null;
  };
  organizationDays: number | null;
  organizationChangedAt?: Date | null;
}

function validDays(days: number | null): days is number {
  return days !== null && Number.isInteger(days) && days > 0;
}

/** A última alteração (da campanha ou da organização) mais o aviso. */
function graceEnd(settings: RetentionSettings): Date | null {
  const changes = [settings.campaign.dataRetentionChangedAt, settings.organizationChangedAt]
    .filter((date): date is Date => date instanceof Date)
    .map((date) => date.getTime());
  return changes.length > 0 ? new Date(Math.max(...changes) + RETENTION_WARNING_DAYS * DAY_MS) : null;
}

export function effectiveRetention(settings: RetentionSettings): EffectiveRetention {
  const { campaign, organizationDays } = settings;
  const startsAt = graceEnd(settings);
  if (campaign.dataRetentionUntil) return { kind: "until", until: campaign.dataRetentionUntil, startsAt };
  if (validDays(campaign.dataRetentionDays)) {
    return { kind: "days", days: campaign.dataRetentionDays, source: "campaign", startsAt };
  }
  if (validDays(organizationDays)) return { kind: "days", days: organizationDays, source: "organization", startsAt };
  return { kind: "none" };
}

/**
 * As participações criadas antes deste instante já passaram o prazo em
 * `now` (e têm pelo menos um dia). Null: nenhuma passou, ou o prazo ainda
 * está nos dias de aviso depois de ter mudado.
 */
export function retentionCutoff(retention: EffectiveRetention, now: Date): Date | null {
  if (retention.kind === "none") return null;
  if (retention.startsAt && now.getTime() < retention.startsAt.getTime()) return null;
  const youngest = now.getTime() - MIN_PARTICIPATION_AGE_MS;
  if (retention.kind === "days") return new Date(Math.min(now.getTime() - retention.days * DAY_MS, youngest));
  return retention.until.getTime() <= now.getTime() ? new Date(youngest) : null;
}

/** Quando uma participação criada em `createdAt` vai ser anonimizada. */
export function anonymizationDate(retention: EffectiveRetention, createdAt: Date): Date | null {
  if (retention.kind === "none") return null;
  const candidates = [createdAt.getTime() + MIN_PARTICIPATION_AGE_MS];
  candidates.push(retention.kind === "days" ? createdAt.getTime() + retention.days * DAY_MS : retention.until.getTime());
  if (retention.startsAt) candidates.push(retention.startsAt.getTime());
  return new Date(Math.max(...candidates));
}

export function describeRetention(retention: EffectiveRetention, timeZone: string, now: Date = new Date()): string {
  if (retention.kind === "none") return "Sem prazo: os dados ficam até serem anonimizados à mão.";
  const format = (date: Date) => new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone }).format(date);
  const pending =
    retention.startsAt && retention.startsAt.getTime() > now.getTime()
      ? ` A anonimização por este prazo começa a ${format(retention.startsAt)} (${RETENTION_WARNING_DAYS} dias depois da alteração).`
      : "";
  if (retention.kind === "days") {
    const origin = retention.source === "organization" ? " (prazo da organização)" : "";
    return `${retention.days} dias depois de cada participação${origin}.${pending}`;
  }
  return `A partir de ${format(retention.until)}, todas as participações.${pending}`;
}
