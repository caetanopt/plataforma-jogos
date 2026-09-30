import type { Prisma, PrizeReleaseReason } from "@/generated/prisma/client";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import {
  isPrizeAwardable,
  NO_COUNTERS,
  startOfDayInTimeZone,
  type PrizeCounters,
} from "@/features/prizes/eligibility";

/**
 * Reserva de prémios da roda (secção 13 e 22).
 *
 * Com o formulário depois do jogo ("Depois do jogo", "Antes de revelar o
 * prémio"), o prémio sorteado fica RESERVADO: a unidade e o código saem do
 * stock disponível, mas só passam a atribuídos quando a lead é aceite. Antes
 * eram atribuídos no sorteio, e uma lead recusada (duplicado, bot) ou
 * abandonada deixava stock e código presos para sempre — um script que
 * rodasse sem submeter esgotava a campanha.
 *
 * Tudo aqui corre dentro da transação serializável de quem chama.
 */

type Tx = Prisma.TransactionClient;

/** Tempo para preencher o formulário antes de a reserva expirar. */
export const PRIZE_RESERVATION_TTL_MS = 30 * 60 * 1000;

/** Contagens por prémio: reservas em curso e unidades já usadas hoje. */
export async function loadPrizeCounters(
  tx: Tx,
  prizeIds: readonly string[],
  now: Date,
  timeZone: string,
): Promise<Map<string, PrizeCounters>> {
  const counters = new Map<string, PrizeCounters>();
  if (prizeIds.length === 0) return counters;
  const ids = [...new Set(prizeIds)];

  const [reserved, today] = await Promise.all([
    tx.prizeAward.groupBy({
      by: ["prizeId"],
      where: { prizeId: { in: ids }, status: "RESERVED", reservationExpiresAt: { gt: now } },
      _count: { _all: true },
    }),
    tx.prizeAward.groupBy({
      by: ["prizeId"],
      where: {
        prizeId: { in: ids },
        status: { in: ["RESERVED", "CONFIRMED"] },
        awardedAt: { gte: startOfDayInTimeZone(now, timeZone) },
      },
      _count: { _all: true },
    }),
  ]);

  for (const id of ids) counters.set(id, { ...NO_COUNTERS });
  for (const row of reserved) counters.get(row.prizeId)!.reservedActive = row._count._all;
  for (const row of today) counters.get(row.prizeId)!.awardedToday = row._count._all;
  return counters;
}

/**
 * Tira um código disponível do prémio (se o prémio tiver códigos). Os que
 * passaram a validade são marcados como expirados antes — não há um job
 * periódico, e este é o único sítio onde um código sai do stock.
 */
async function takeCode(tx: Tx, prizeId: string, now: Date, status: "RESERVED" | "ASSIGNED") {
  await tx.prizeCode.updateMany({
    where: { prizeId, status: "AVAILABLE", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  const findAvailable = () =>
    tx.prizeCode.findFirst({ where: { prizeId, status: "AVAILABLE" }, orderBy: { createdAt: "asc" } });
  let code = await findAvailable();
  if (!code) {
    // Os códigos podem estar presos em reservas expiradas que o lote do
    // sorteio ainda não libertou: liberta as deste prémio que têm código e
    // tenta de novo, em vez de atribuir o prémio sem código. (Só as que têm
    // código: um prémio sem códigos não tem nada a recuperar.)
    if ((await releaseExpired(tx, { prizeId, prizeCodeId: { not: null } }, now)) > 0) code = await findAvailable();
  }
  if (!code) return null;
  await tx.prizeCode.update({
    where: { id: code.id },
    data: { status, assignedAt: status === "ASSIGNED" ? now : null },
  });
  return code;
}

interface AwardRef {
  id: string;
  prizeCodeId: string | null;
  wheelSegmentId: string | null;
}

/**
 * Liberta uma reserva: o código volta a estar disponível (ou expira, se já
 * passou a validade) e a unidade do segmento volta ao stock. Só atua sobre
 * uma reserva — a guarda no `where` torna-a idempotente e resolve corridas
 * entre duas limpezas.
 */
export async function releaseReservation(
  tx: Tx,
  award: AwardRef,
  reason: PrizeReleaseReason,
  now: Date,
): Promise<boolean> {
  const released = await tx.prizeAward.updateMany({
    where: { id: award.id, status: "RESERVED" },
    // O código deixa de estar ligado: é único por award e tem de poder ir
    // para outra pessoa.
    data: { status: "RELEASED", releaseReason: reason, releasedAt: now, prizeCodeId: null },
  });
  if (released.count === 0) return false;

  if (award.prizeCodeId) {
    const code = await tx.prizeCode.findUnique({ where: { id: award.prizeCodeId } });
    if (code && code.status === "RESERVED") {
      await tx.prizeCode.update({
        where: { id: code.id },
        data: { status: code.expiresAt && code.expiresAt < now ? "EXPIRED" : "AVAILABLE", assignedAt: null },
      });
    }
  }
  if (award.wheelSegmentId) {
    // Nunca acima do total: se o limite do segmento mudou (ou passou a existir)
    // depois do sorteio, a unidade devolvida não pode abrir mais do que ele.
    await tx.$executeRaw`
      UPDATE "WheelSegment"
      SET "remainingQuantity" = LEAST(COALESCE("remainingQuantity", 0) + 1, "totalQuantity")
      WHERE "id" = ${award.wheelSegmentId} AND "totalQuantity" IS NOT NULL`;
  }
  return true;
}

/** Reservas expiradas libertadas por sorteio (ver releaseExpiredReservations). */
export const EXPIRED_RELEASE_BATCH = 25;

/**
 * Liberta as reservas da campanha que passaram o prazo. Corre no início de
 * cada sorteio, antes de escolher códigos: sem isto um código reservado por
 * quem abandonou o formulário nunca voltava ao stock.
 *
 * No máximo um lote por sorteio, as mais antigas primeiro: com milhares por
 * libertar (uma campanha pausada depois de um pico), libertá-las todas de uma
 * vez passava o tempo da transação, tudo voltava atrás e nenhuma rotação
 * conseguia correr. O stock do prémio não depende disto — as reservas
 * expiradas já não contam (loadPrizeCounters) —, só os códigos e as unidades
 * dos segmentos voltam aos poucos.
 */
export async function releaseExpiredReservations(tx: Tx, campaignId: string, now: Date): Promise<number> {
  return releaseExpired(tx, { prize: { campaignId } }, now);
}

async function releaseExpired(tx: Tx, scope: Prisma.PrizeAwardWhereInput, now: Date): Promise<number> {
  const expired = await tx.prizeAward.findMany({
    where: { ...scope, status: "RESERVED", reservationExpiresAt: { lte: now } },
    select: { id: true, prizeCodeId: true, wheelSegmentId: true },
    orderBy: { reservationExpiresAt: "asc" },
    take: EXPIRED_RELEASE_BATCH,
  });
  let count = 0;
  for (const award of expired) {
    if (await releaseReservation(tx, award, "EXPIRED", now)) count += 1;
  }
  return count;
}

export interface NewAwardInput {
  participationId: string;
  prizeId: string;
  wheelSegmentId: string;
  hold: boolean;
  now: Date;
}

/**
 * Grava o prémio sorteado: reservado (fica à espera da lead) ou atribuído
 * de imediato. A elegibilidade já foi verificada pelo sorteio.
 */
export async function createAward(tx: Tx, input: NewAwardInput): Promise<{ code: string | null }> {
  const { participationId, prizeId, wheelSegmentId, hold, now } = input;
  const code = await takeCode(tx, prizeId, now, hold ? "RESERVED" : "ASSIGNED");

  if (!hold) {
    await tx.prize.update({ where: { id: prizeId }, data: { awardedQuantity: { increment: 1 } } });
  }
  await tx.prizeAward.create({
    data: {
      participationId,
      prizeId,
      wheelSegmentId,
      prizeCodeId: code?.id ?? null,
      awardedAt: now,
      status: hold ? "RESERVED" : "CONFIRMED",
      reservationExpiresAt: hold ? new Date(now.getTime() + PRIZE_RESERVATION_TTL_MS) : null,
      confirmedAt: hold ? null : now,
    },
  });
  return { code: hold ? null : (code?.code ?? null) };
}

export type SettleOutcome = "none" | "confirmed" | "already_confirmed" | "lost";

/**
 * Confirma a reserva de uma participação: a lead foi aceite (ou o formulário
 * deixou de ser pedido). É chamada na mesma transação que grava a lead.
 *
 * - Reserva dentro do prazo: passa a atribuída, com o código que já tinha.
 * - Reserva expirada: tenta obter de novo uma unidade do mesmo prémio, com as
 *   regras do sorteio (ativo, período, stock, limite diário) e a campanha
 *   ainda no ar. O participante nunca viu o código anterior, por isso pode
 *   receber outro.
 * - Libertada por duplicado ou bot: perdida.
 */
export async function settleReservation(tx: Tx, participationId: string, now: Date): Promise<SettleOutcome> {
  const award = await tx.prizeAward.findUnique({
    where: { participationId },
    include: {
      prize: true,
      wheelSegment: { select: { id: true, totalQuantity: true, remainingQuantity: true } },
      participation: {
        select: {
          campaign: { select: { id: true, timezone: true, status: true, scheduleStartAt: true, scheduleEndAt: true } },
        },
      },
    },
  });
  if (!award) return "none";
  if (award.status === "CONFIRMED") return "already_confirmed";
  if (award.status === "RELEASED" && award.releaseReason !== "EXPIRED") return "lost";

  if (award.status === "RESERVED" && award.reservationExpiresAt && award.reservationExpiresAt > now) {
    const confirmed = await tx.prizeAward.updateMany({
      where: { id: award.id, status: "RESERVED" },
      data: { status: "CONFIRMED", confirmedAt: now, reservationExpiresAt: null },
    });
    if (confirmed.count === 0) return "lost";
    await tx.prize.update({ where: { id: award.prizeId }, data: { awardedQuantity: { increment: 1 } } });
    if (award.prizeCodeId) {
      await tx.prizeCode.update({ where: { id: award.prizeCodeId }, data: { status: "ASSIGNED", assignedAt: now } });
    }
    return "confirmed";
  }

  // Expirada (ainda por limpar ou já libertada): devolve o que tinha e tenta
  // de novo, como num sorteio.
  if (award.status === "RESERVED") await releaseReservation(tx, award, "EXPIRED", now);

  const campaign = award.participation.campaign;
  if (getEffectivePublicState(campaign) !== "active") return "lost";

  const counters = (await loadPrizeCounters(tx, [award.prizeId], now, campaign.timezone)).get(award.prizeId);
  if (!isPrizeAwardable(award.prize, campaign.id, now, counters ?? NO_COUNTERS)) return "lost";

  const segment = award.wheelSegment;
  if (segment && segment.totalQuantity != null) {
    const taken = await tx.wheelSegment.updateMany({
      where: { id: segment.id, remainingQuantity: { gt: 0 } },
      data: { remainingQuantity: { decrement: 1 } },
    });
    if (taken.count === 0) return "lost";
  }

  const code = await takeCode(tx, award.prizeId, now, "ASSIGNED");
  await tx.prize.update({ where: { id: award.prizeId }, data: { awardedQuantity: { increment: 1 } } });
  await tx.prizeAward.update({
    where: { id: award.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: now,
      // A unidade conta para o limite diário de hoje, não do dia do sorteio.
      awardedAt: now,
      prizeCodeId: code?.id ?? null,
      reservationExpiresAt: null,
      releasedAt: null,
      releaseReason: null,
    },
  });
  return "confirmed";
}

/** Liberta a reserva de uma participação (lead recusada). */
export async function releaseParticipationReservation(
  tx: Tx,
  participationId: string,
  reason: PrizeReleaseReason,
  now: Date,
): Promise<boolean> {
  const award = await tx.prizeAward.findUnique({
    where: { participationId },
    select: { id: true, status: true, prizeCodeId: true, wheelSegmentId: true },
  });
  if (!award || award.status !== "RESERVED") return false;
  return releaseReservation(tx, award, reason, now);
}
