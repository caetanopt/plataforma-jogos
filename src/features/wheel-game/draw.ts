import { randomInt } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { WheelSegment } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

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

function isSegmentEligible(segment: WheelSegment, now: Date): boolean {
  if (!segment.isActive) return false;
  if (segment.periodStart && segment.periodStart > now) return false;
  if (segment.periodEnd && segment.periodEnd < now) return false;
  if (segment.totalQuantity != null && (segment.remainingQuantity ?? 0) <= 0) return false;
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

const MAX_SERIALIZATION_RETRIES = 10;

function backoffDelayMs(attempt: number): number {
  const base = Math.min(200, 10 * 2 ** attempt);
  return Math.random() * base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deteta conflitos de escrita em transações serializáveis para permitir
 * repetir a tentativa. O driver adapter (@prisma/adapter-pg, usado pelo
 * Prisma 7) reporta isto como `DriverAdapterError` com causa
 * `{ kind: "TransactionWriteConflict" }`, em vez do antigo código de erro
 * P2034 do motor Rust — por isso a deteção cobre ambas as formas.
 */
function isSerializationConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" || error.message.includes("could not serialize");
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { kind?: string } }).cause;
    if (cause?.kind === "TransactionWriteConflict") return true;
    return error.name === "DriverAdapterError" && error.message.includes("TransactionWriteConflict");
  }
  return false;
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
  isTest = false,
): Promise<WheelDrawResult> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const participation = await tx.participation.findUniqueOrThrow({
            where: { id: participationId },
          });

          if (participation.resultSummary) {
            const persisted = participation.resultSummary as unknown as PersistedWheelResult;
            return { ...persisted, alreadyResolved: true };
          }

          const wheelConfig = await tx.wheelConfig.findUnique({
            where: { campaignId: participation.campaignId },
            include: { segments: true },
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
              if (prizeRecord.totalQuantity != null && prizeRecord.awardedQuantity >= prizeRecord.totalQuantity) {
                throw new NoEligibleSegmentsError();
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 10_000 },
      );
    } catch (error) {
      if (isSerializationConflict(error) && attempt < MAX_SERIALIZATION_RETRIES - 1) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Não foi possível determinar o resultado após várias tentativas.");
}
