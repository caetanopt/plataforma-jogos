import type {
  CampaignType,
  DedupStrategy,
  ParticipationLimitType,
  Participation,
} from "@/generated/prisma/client";
import { runSerializable } from "@/lib/db/transaction-retry";
import { checkParticipationAllowed } from "@/features/play/limits";

export interface CreateParticipationInput {
  organizationId: string;
  campaignId: string;
  campaignVersionId: string;
  campaignType: CampaignType;
  participationLimitType: ParticipationLimitType;
  participationCustomMax: number | null;
  dedupStrategies: DedupStrategy[];
  quizMaxAttempts: number | null;
  idempotencyKey: string;
  isTest: boolean;
  cookieId: string;
  ip: string | null;
  sessionId: string;
  source?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  deviceType: string | null;
  browser: string | null;
  os: string | null;
}

export type CreateParticipationResult =
  | { kind: "existing"; participation: Participation }
  | { kind: "blocked" }
  | { kind: "created"; participation: Participation };

/**
 * Verifica o limite de participação e cria a participação — sempre na
 * mesma transação serializável (ver `runSerializable`), para que dois
 * pedidos concorrentes do mesmo visitante nunca possam ambos passar a
 * verificação antes de qualquer um gravar a sua participação. Extraído de
 * `startParticipationAction` para não depender de `next/headers` — fica
 * assim testável diretamente, com uma base de dados real, incluindo em
 * cenários de concorrência.
 */
export async function createParticipationIfAllowed(
  input: CreateParticipationInput,
): Promise<CreateParticipationResult> {
  return runSerializable(async (tx) => {
    const existing = await tx.participation.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      return { kind: "existing" as const, participation: existing };
    }

    const participant = await tx.participant.upsert({
      where: {
        organizationId_cookieId: { organizationId: input.organizationId, cookieId: input.cookieId },
      },
      create: { organizationId: input.organizationId, cookieId: input.cookieId },
      update: {},
    });

    if (!input.isTest) {
      const allowed = await checkParticipationAllowed(tx, {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        limitType: input.participationLimitType,
        customMax: input.participationCustomMax,
        dedupStrategies: input.dedupStrategies,
        cookieId: input.cookieId,
        ip: input.ip,
        sessionId: input.sessionId,
        now: new Date(),
      });
      if (!allowed) return { kind: "blocked" as const };
    }

    // "Máx. tentativas" do Quiz (secção 14) — limite de repetições distinto e
    // adicional às regras de participação gerais da campanha, aplicado por
    // visitante (identificado pelo cookie, tal como o resto deste fluxo para
    // anónimos).
    if (!input.isTest && input.campaignType === "QUIZ" && input.quizMaxAttempts != null) {
      const attemptsUsed = await tx.participation.count({
        where: { campaignId: input.campaignId, isTest: false, participantId: participant.id },
      });
      if (attemptsUsed >= input.quizMaxAttempts) return { kind: "blocked" as const };
    }

    const participation = await tx.participation.create({
      data: {
        campaignId: input.campaignId,
        campaignVersionId: input.campaignVersionId,
        participantId: participant.id,
        isTest: input.isTest,
        idempotencyKey: input.idempotencyKey,
        source: input.source,
        utmSource: input.utm?.source,
        utmMedium: input.utm?.medium,
        utmCampaign: input.utm?.campaign,
        utmContent: input.utm?.content,
        utmTerm: input.utm?.term,
        sessionId: input.sessionId,
        ipAddress: input.ip,
        deviceType: input.deviceType,
        browser: input.browser,
        os: input.os,
      },
    });

    return { kind: "created" as const, participation };
  });
}
