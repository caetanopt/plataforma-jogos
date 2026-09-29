import { prisma } from "@/server/db/client";

/**
 * Reservas em curso por prémio (a aguardar a lead, dentro do prazo). É um
 * retrato do momento, como os alertas: não depende do período escolhido.
 * As expiradas não contam — já não estão presas a ninguém, mesmo que o
 * sorteio seguinte ainda não as tenha libertado.
 */
export async function activeReservationsByPrize(
  prizeIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, number>> {
  if (prizeIds.length === 0) return new Map();
  const rows = await prisma.prizeAward.groupBy({
    by: ["prizeId"],
    where: { prizeId: { in: [...new Set(prizeIds)] }, status: "RESERVED", reservationExpiresAt: { gt: now } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.prizeId, row._count._all]));
}

/** Unidades que ainda podem sair: total − atribuídas − reservadas, nunca negativo. */
export function remainingStock(prize: { totalQuantity: number | null; awardedQuantity: number }, reserved: number): number | null {
  if (prize.totalQuantity == null) return null;
  return Math.max(0, prize.totalQuantity - prize.awardedQuantity - reserved);
}
