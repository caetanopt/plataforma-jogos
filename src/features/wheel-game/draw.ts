import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { withLock } from "@/server/cache/lock";
import { runSerializable } from "@/lib/db/transaction-retry";
import { isSegmentEligible, weightedPick } from "@/features/prizes/eligibility";
import {
  createAward,
  loadPrizeCounters,
  releaseExpiredReservations,
  settleReservation,
} from "@/features/prizes/reservation";
import { holdsPrizeUntilLead, participationLeadFormPosition, visibleFieldCount, type PrizeDelivery } from "@/features/play/reveal";

export class NoEligibleSegmentsError extends Error {
  constructor() {
    super("Não existem segmentos elegíveis para esta rotação.");
    this.name = "NoEligibleSegmentsError";
  }
}

/** A participação foi anonimizada entre a verificação e o sorteio. */
export class ParticipationAnonymizedError extends Error {
  constructor() {
    super("A participação foi anonimizada.");
    this.name = "ParticipationAnonymizedError";
  }
}

/**
 * O que fica gravado em `Participation.resultSummary`. O código não: vive
 * no PrizeAward/PrizeCode, a única fonte de verdade sobre a entrega (uma
 * reserva pode expirar e ser reposta com outro código). Resultados antigos
 * têm `prize.code`, que é ignorado.
 */
interface PersistedWheelResult {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: { id: string; publicName: string; instructions: string | null } | null;
}

export interface WheelDrawResult extends PersistedWheelResult {
  delivery: PrizeDelivery;
  /** Só com o prémio atribuído. */
  code: string | null;
  alreadyResolved: boolean;
  /** O prémio passou a atribuído neste pedido (conta como `prize_awarded`). */
  confirmedNow: boolean;
}

type Tx = Prisma.TransactionClient;

/** Entrega do prémio de uma participação, lida do PrizeAward. */
async function readDelivery(
  tx: Tx,
  participationId: string,
  isTest: boolean,
  hasPrize: boolean,
): Promise<{ delivery: PrizeDelivery; code: string | null }> {
  if (!hasPrize) return { delivery: "none", code: null };
  if (isTest) return { delivery: "test", code: null };
  const award = await tx.prizeAward.findUnique({
    where: { participationId },
    select: { status: true, prizeCode: { select: { code: true } } },
  });
  if (!award) return { delivery: "released", code: null };
  if (award.status === "CONFIRMED") return { delivery: "confirmed", code: award.prizeCode?.code ?? null };
  if (award.status === "RESERVED") return { delivery: "reserved", code: null };
  return { delivery: "released", code: null };
}

/**
 * Motor de resultado da Roda da Sorte (secção 13). Calcula e grava o
 * resultado inteiramente no servidor, dentro de uma transação serializável:
 * elegibilidade, sorteio ponderado, stock e prémio/código acontecem
 * atomicamente. Idempotente — chamar novamente para a mesma participação
 * devolve sempre o resultado já gravado, nunca sorteia de novo.
 *
 * Se a lead ainda vai ser pedida ("Depois do jogo", "Antes de revelar o
 * prémio"), o prémio fica reservado; é confirmado quando a lead for aceite.
 * A decisão lê a participação na base de dados, nunca o pedido.
 */
export async function drawAndAwardPrize(participationId: string, now: Date = new Date()): Promise<WheelDrawResult> {
  // As rotações da mesma campanha passam uma de cada vez (ver withLock): em
  // rajada, os conflitos da transação serializável esgotavam as tentativas.
  const { campaignId } = await prisma.participation.findUniqueOrThrow({
    where: { id: participationId },
    select: { campaignId: true },
  });
  return withLock(`lock:wheel-draw:${campaignId}`, () => drawInTransaction(participationId, now));
}

async function drawInTransaction(participationId: string, now: Date): Promise<WheelDrawResult> {
  return runSerializable(async (tx) => {
    const participation = await tx.participation.findUniqueOrThrow({
      where: { id: participationId },
      select: {
        id: true,
        campaignId: true,
        isTest: true,
        resultSummary: true,
        leadFormResponse: true,
        leadFormPosition: true,
        anonymizedAt: true,
        campaign: {
          select: {
            timezone: true,
            leadForm: {
              select: { position: true, fields: { select: { type: true } }, consentDefinitions: { select: { id: true } } },
            },
          },
        },
      },
    });

    // Anonimizada depois de passar a verificação do jogo (a pedido, num
    // separador ainda aberto): nada se sorteia nem se atribui.
    if (participation.anonymizedAt) throw new ParticipationAnonymizedError();

    // O modo de teste é sempre lido da participação gravada, nunca de um
    // parâmetro do pedido — spinWheelAction é um endpoint público, e um valor
    // recebido do cliente poderia ser falsificado para consumir stock real
    // numa participação de teste (ou vice-versa).
    const isTest = participation.isTest;
    const leadSubmitted = participation.leadFormResponse !== null;
    const liveForm = participation.campaign.leadForm;
    const position = participationLeadFormPosition(
      participation.leadFormPosition,
      liveForm
        ? {
            position: liveForm.position,
            fieldCount: visibleFieldCount(liveForm.fields),
            consentCount: liveForm.consentDefinitions.length,
          }
        : null,
    );
    const hold = holdsPrizeUntilLead(position, leadSubmitted, isTest);

    if (participation.resultSummary) {
      const persisted = participation.resultSummary as unknown as PersistedWheelResult;
      const hasPrize = Boolean(persisted.prize);
      let { delivery, code } = await readDelivery(tx, participation.id, isTest, hasPrize);
      // Reserva que já não precisa de lead (o formulário foi desligado ou
      // esvaziado depois do sorteio): confirma-se agora. Só reservas: um
      // prémio dado como perdido não volta a ser tentado a cada pedido.
      let confirmedNow = false;
      if (delivery === "reserved" && !hold) {
        confirmedNow = (await settleReservation(tx, participation.id, now)) === "confirmed";
        ({ delivery, code } = await readDelivery(tx, participation.id, isTest, hasPrize));
      }
      return {
        segmentId: persisted.segmentId,
        segmentName: persisted.segmentName,
        outcome: persisted.outcome,
        message: persisted.message,
        prize: persisted.prize
          ? { id: persisted.prize.id, publicName: persisted.prize.publicName, instructions: persisted.prize.instructions }
          : null,
        delivery,
        code,
        alreadyResolved: true,
        confirmedNow,
      };
    }

    // Reservas abandonadas voltam ao stock antes de se calcular o que resta.
    if (!isTest) await releaseExpiredReservations(tx, participation.campaignId, now);

    const wheelConfig = await tx.wheelConfig.findUnique({
      where: { campaignId: participation.campaignId },
      include: { segments: { include: { prize: true } } },
    });
    if (!wheelConfig) throw new Error("Roda da Sorte não configurada para esta campanha.");

    const prizeIds = wheelConfig.segments.flatMap((segment) =>
      segment.outcome === "WIN" && segment.prize ? [segment.prize.id] : [],
    );
    const counters = await loadPrizeCounters(tx, prizeIds, now, participation.campaign.timezone);

    const eligible = wheelConfig.segments.filter((segment) =>
      isSegmentEligible(segment, participation.campaignId, now, counters),
    );
    if (eligible.length === 0) throw new NoEligibleSegmentsError();

    const chosen = weightedPick(eligible);
    const prizeRecord = chosen.outcome === "WIN" ? chosen.prize : null;

    let delivery: PrizeDelivery = "none";
    let code: string | null = null;
    if (prizeRecord) {
      if (isTest) {
        // Modo de teste: nunca consome stock nem atribui código real (secção 18).
        delivery = "test";
      } else {
        const created = await createAward(tx, {
          participationId,
          prizeId: prizeRecord.id,
          wheelSegmentId: chosen.id,
          hold,
          now,
        });
        delivery = hold ? "reserved" : "confirmed";
        code = created.code;
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
      prize: prizeRecord
        ? { id: prizeRecord.id, publicName: prizeRecord.publicName, instructions: prizeRecord.instructions }
        : null,
    };

    await tx.participation.update({
      where: { id: participationId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        resultSummary: persisted as unknown as Prisma.InputJsonValue,
      },
    });

    return { ...persisted, delivery, code, alreadyResolved: false, confirmedNow: delivery === "confirmed" };
  });
}
