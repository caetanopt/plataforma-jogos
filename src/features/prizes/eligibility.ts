import { randomInt } from "node:crypto";
import { utcToZonedDateTimeLocal, zonedDateTimeToUtc } from "@/lib/dates/timezone";

/**
 * Regras puras de elegibilidade do sorteio da roda (secção 13). Sem acesso à
 * base de dados: as contagens chegam já calculadas, dentro da transação do
 * sorteio (ver reservation.ts).
 */

export interface PrizeForEligibility {
  id: string;
  campaignId: string;
  isActive: boolean;
  startAt: Date | null;
  endAt: Date | null;
  totalQuantity: number | null;
  awardedQuantity: number;
  dailyLimit: number | null;
}

/** Contagens do momento, por prémio. */
export interface PrizeCounters {
  /** Reservas ainda dentro do prazo (a lead ainda pode ser aceite). */
  reservedActive: number;
  /** Reservados e atribuídos desde a meia-noite, no fuso da campanha. */
  awardedToday: number;
}

export const NO_COUNTERS: PrizeCounters = { reservedActive: 0, awardedToday: 0 };

/**
 * Um prémio pode sair agora? Ativo, dentro do período, com stock (contando
 * as reservas por confirmar, que não estão disponíveis para mais ninguém) e
 * abaixo do limite diário.
 *
 * Antes, o estado e as datas do prémio não contavam: desligar "Ativo" no
 * editor não tinha efeito no jogo. E o limite diário era verificado depois
 * do sorteio, fazendo falhar a rotação em vez de retirar o prémio.
 */
export function isPrizeAwardable(
  prize: PrizeForEligibility,
  campaignId: string,
  now: Date,
  counters: PrizeCounters,
): boolean {
  if (prize.campaignId !== campaignId) return false;
  if (!prize.isActive) return false;
  if (prize.startAt && prize.startAt > now) return false;
  if (prize.endAt && prize.endAt < now) return false;
  if (prize.totalQuantity != null && prize.awardedQuantity + counters.reservedActive >= prize.totalQuantity) {
    return false;
  }
  if (prize.dailyLimit != null && counters.awardedToday >= prize.dailyLimit) return false;
  return true;
}

export interface SegmentForEligibility {
  id: string;
  weight: number;
  isActive: boolean;
  outcome: "WIN" | "NO_WIN";
  periodStart: Date | null;
  periodEnd: Date | null;
  totalQuantity: number | null;
  remainingQuantity: number | null;
  prize: PrizeForEligibility | null;
}

/**
 * Um segmento vencedor cujo prémio não pode sair agora fica fora do sorteio
 * (não passa a "não ganhou"): a roda nunca pára no nome de um prémio para
 * dizer que não foi desta vez. O peso dele reparte-se proporcionalmente
 * pelos restantes, como já acontecia com o stock esgotado.
 *
 * Um segmento ligado a um prémio de outra campanha nunca é elegível (as
 * ações do editor recusam essa ligação; isto cobre dados antigos).
 */
export function isSegmentEligible(
  segment: SegmentForEligibility,
  campaignId: string,
  now: Date,
  countersByPrize: ReadonlyMap<string, PrizeCounters>,
): boolean {
  if (!segment.isActive || segment.weight <= 0) return false;
  if (segment.periodStart && segment.periodStart > now) return false;
  if (segment.periodEnd && segment.periodEnd < now) return false;
  if (segment.totalQuantity != null && (segment.remainingQuantity ?? 0) <= 0) return false;
  if (segment.prize && segment.prize.campaignId !== campaignId) return false;
  if (segment.outcome === "WIN" && segment.prize) {
    const counters = countersByPrize.get(segment.prize.id) ?? NO_COUNTERS;
    if (!isPrizeAwardable(segment.prize, campaignId, now, counters)) return false;
  }
  return true;
}

/**
 * Escolha ponderada para um valor `roll` em [0, soma dos pesos). Separada
 * da aleatoriedade para se poder testar a distribuição.
 */
export function pickByRoll<T extends { weight: number }>(segments: readonly T[], roll: number): T {
  let remaining = roll;
  for (const segment of segments) {
    if (remaining < segment.weight) return segment;
    remaining -= segment.weight;
  }
  // Não deve acontecer; fallback defensivo para o último segmento.
  return segments[segments.length - 1];
}

/**
 * Sorteio ponderado com aleatoriedade criptográfica. O peso nunca é exposto
 * ao cliente — apenas o resultado final (secção 13).
 */
export function weightedPick<T extends { weight: number }>(segments: readonly T[]): T {
  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  return pickByRoll(segments, randomInt(0, totalWeight));
}

/**
 * Meia-noite de hoje no fuso da campanha, em UTC. O limite diário usava a
 * meia-noite do processo do servidor (UTC em produção): em Lisboa, no
 * verão, o "dia" do prémio começava à 1h.
 */
export function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = utcToZonedDateTimeLocal(now, timeZone);
  return zonedDateTimeToUtc(`${local.slice(0, 10)}T00:00`, timeZone) ?? now;
}
