import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { Prize, WheelSegment } from "@/generated/prisma/client";
import { runSerializable } from "@/lib/db/transaction-retry";

type WheelSegmentWithPrize = WheelSegment & { prize: Prize | null };

export class NoEligibleSegmentsError extends Error {
  constructor() {
    super("Não existem segmentos elegíveis para esta rotação.");
    this.name = "NoEligibleSegmentsError";
  }
}

interface WheelPrizeResult {
  id: string;
  publicName: string;
  instructions: string | null;
  code: string | null;
}

interface PersistedWheelResult {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: WheelPrizeResult | null;
}

export interface WheelDrawResult extends PersistedWheelResult {
  alreadyResolved: boolean;
}

/**
 * Um segmento "WIN" pode partilhar o stock do prémio com outros segmentos
 * (o stock vive no `Prize`, não só no `WheelSegment.remainingQuantity`, que é
 * opcional). Ignorar o stock do prémio ligado deixava o segmento
 * "elegível" mesmo com o prémio esgotado — era escolhido pelo sorteio
 * ponderado e só depois falhava (abortando a rotação inteira), distorcendo
 * a distribuição real de probabilidade e bloqueando rotações legítimas.
 */
function isSegmentEligible(segment: WheelSegmentWithPrize, now: Date): boolean {
  if (!segment.isActive) return false;
  if (segment.periodStart && segment.periodStart > now) return false;
  if (segment.periodEnd && segment.periodEnd < now) return false;
  if (segment.totalQuantity != null && (segment.remainingQuantity ?? 0) <= 0) return false;
  if (segment.outcome === "WIN" && segment.prize) {
    const prize = segment.prize;
    if (prize.totalQuantity != null && prize.awardedQuantity >= prize.totalQuantity) return false;
  }
  return true;
}

/**
 * Seleção aleatória segura ponderada pelo peso de cada segmento. O peso
 * nunca é exposto ao cliente — apenas o resultado final (secção 13).
 */
function weightedPick(segments: WheelSegment[]): WheelSegment {
  const totalWeight = segments.reduce((sum, s) => sum + s.weight, 0);
  let roll = randomInt(0, totalWeight);
  for (const segment of segments) {
    if (roll < segment.weight) return segment;
    roll -= segment.weight;
  }
  // Não deve acontecer; fallback defensivo para o último segmento.
  return segments[segments.length - 1];
}

/**
 * Motor de resultado da Roda da Sorte (secção 13). Calcula e grava o
 * resultado inteiramente no servidor, dentro de uma transação serializável:
 * elegibilidade, sorteio ponderado, decremento de stock e atribuição de
 * prémio/código acontecem atomicamente. Idempotente — chamar novamente para
 * a mesma participação devolve sempre o resultado já gravado, nunca sorteia
 * de novo.
 */
export async function drawAndAwardPrize(
  participationId: string,
  now: Date = new Date(),
): Promise<WheelDrawResult> {
  return runSerializable(async (tx) => {
    const participation = await tx.participation.findUniqueOrThrow({
      where: { id: participationId },
    });

    if (participation.resultSummary) {
      const persisted = participation.resultSummary as unknown as PersistedWheelResult;
      return { ...persisted, alreadyResolved: true };
    }

    // O modo de teste é sempre lido da participação gravada na BD, nunca
    // de um parâmetro do pedido — spinWheelAction é uma Server Action,
    // logo um endpoint HTTP invocável diretamente, e um valor recebido do
    // cliente poderia ser falsificado para consumir stock/atribuir
    // prémios reais numa participação de teste (ou vice-versa).
    const isTest = participation.isTest;

    const wheelConfig = await tx.wheelConfig.findUnique({
      where: { campaignId: participation.campaignId },
      include: { segments: { include: { prize: true } } },
    });
    if (!wheelConfig) throw new Error("Roda da Sorte não configurada para esta campanha.");

    const eligible = wheelConfig.segments.filter((segment) => isSegmentEligible(segment, now));
    if (eligible.length === 0) throw new NoEligibleSegmentsError();

    const chosen = weightedPick(eligible);

    let prize: WheelPrizeResult | null = null;

    if (chosen.outcome === "WIN" && chosen.prizeId) {
      const prizeRecord = await tx.prize.findUniqueOrThrow({ where: { id: chosen.prizeId } });

      if (isTest) {
        // Modo de teste: nunca consome stock nem atribui código real (secção 18).
        prize = {
          id: prizeRecord.id,
          publicName: prizeRecord.publicName,
          instructions: prizeRecord.instructions,
          code: null,
        };
      } else {
        if (
          prizeRecord.totalQuantity != null &&
          prizeRecord.awardedQuantity >= prizeRecord.totalQuantity
        ) {
          throw new NoEligibleSegmentsError();
        }

        if (prizeRecord.dailyLimit != null) {
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
          const awardedToday = await tx.prizeAward.count({
            where: { prizeId: prizeRecord.id, awardedAt: { gte: startOfDay } },
          });
          if (awardedToday >= prizeRecord.dailyLimit) {
            throw new NoEligibleSegmentsError();
          }
        }

        await tx.prize.update({
          where: { id: prizeRecord.id },
          data: { awardedQuantity: { increment: 1 } },
        });

        const availableCode = await tx.prizeCode.findFirst({
          where: { prizeId: prizeRecord.id, status: "AVAILABLE" },
        });
        let prizeCodeId: string | null = null;
        let assignedCode: string | null = null;
        if (availableCode) {
          await tx.prizeCode.update({
            where: { id: availableCode.id },
            data: { status: "ASSIGNED", assignedAt: now },
          });
          prizeCodeId = availableCode.id;
          assignedCode = availableCode.code;
        }

        await tx.prizeAward.create({
          data: {
            participationId,
            prizeId: prizeRecord.id,
            wheelSegmentId: chosen.id,
            prizeCodeId,
            awardedAt: now,
          },
        });

        prize = {
          id: prizeRecord.id,
          publicName: prizeRecord.publicName,
          instructions: prizeRecord.instructions,
          code: assignedCode,
        };
      }
    }

    if (!isTest && chosen.totalQuantity != null) {
      await tx.wheelSegment.update({
        where: { id: chosen.id },
        data: { remainingQuantity: { decrement: 1 } },
      });
    }

    const persisted: PersistedWheelResult = {
      segmentId: chosen.id,
      segmentName: chosen.name,
      outcome: chosen.outcome,
      message: chosen.message,
      prize,
    };

    await tx.participation.update({
      where: { id: participationId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        resultSummary: persisted as unknown as Prisma.InputJsonValue,
      },
    });

    return { ...persisted, alreadyResolved: false };
  });
}
