"use server";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { checkParticipationAllowed } from "@/features/play/limits";
import { createParticipationIfAllowed } from "@/features/play/create-participation";
import { getOrCreateVisitorCookieId } from "@/features/play/cookie";
import { getRequestIp } from "@/lib/security/request-ip";
import { parseUserAgent } from "@/features/play/user-agent";
import { canTestCampaign } from "@/features/play/test-mode";
import { headers } from "next/headers";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { computeMemoryScore } from "@/features/memory-game/scoring";
import { computeQuizScore, matchResultProfile } from "@/features/quiz-game/scoring";
import { drawAndAwardPrize, NoEligibleSegmentsError } from "@/features/wheel-game/draw";
import type {
  QuizPlayerResult,
  QuizPlayerSubmission,
} from "@/components/public-game/quiz-game-player";
import type { WheelSpinResult } from "@/components/public-game/wheel-game-player";

async function recordEvent(
  campaignId: string,
  type:
    | "CAMPAIGN_VIEWED"
    | "START_CLICKED"
    | "LEAD_FORM_VIEWED"
    | "LEAD_FORM_SUBMITTED"
    | "GAME_STARTED"
    | "GAME_COMPLETED"
    | "GAME_ABANDONED"
    | "RESULT_VIEWED"
    | "CTA_CLICKED"
    | "PARTICIPATION_BLOCKED"
    | "PRIZE_AWARDED",
  isTest: boolean,
  sessionId?: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.analyticsEvent.create({
    data: {
      campaignId,
      type,
      isTest,
      sessionId: sessionId ?? undefined,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function recordAnalyticsEventAction(
  campaignId: string,
  type: "CAMPAIGN_VIEWED" | "START_CLICKED" | "CTA_CLICKED",
  isTest: boolean,
  sessionId?: string,
): Promise<void> {
  await recordEvent(campaignId, type, isTest, sessionId);
}

export interface StartParticipationInput {
  campaignId: string;
  idempotencyKey: string;
  sessionId: string;
  testRequested: boolean;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  source?: string;
}

export type StartParticipationResult =
  | { ok: true; participationId: string; isTest: boolean }
  | { ok: false; reason: "not_active" | "limit_reached" | "rate_limited" | "not_found" };

export async function startParticipationAction(
  input: StartParticipationInput,
): Promise<StartParticipationResult> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      type: true,
      scheduleStartAt: true,
      scheduleEndAt: true,
      participationLimitType: true,
      participationCustomMax: true,
      dedupStrategies: true,
      quizConfig: { select: { maxAttempts: true } },
    },
  });
  if (!campaign) return { ok: false, reason: "not_found" };

  const effectiveState = getEffectivePublicState(campaign);
  if (effectiveState !== "active") return { ok: false, reason: "not_active" };

  const ip = await getRequestIp();
  const cookieId = await getOrCreateVisitorCookieId();
  // Sem IP (proxy/CDN que não define x-forwarded-for), usa o cookie do
  // visitante em vez de um balde "unknown" partilhado por todos — evita que
  // muitos visitantes sem IP detetável se bloqueiem uns aos outros.
  const rateLimit = await checkRateLimit(
    `participation:${campaign.id}:${ip ?? cookieId}`,
    30,
    3600,
  );
  if (!rateLimit.allowed) return { ok: false, reason: "rate_limited" };

  const isTest = input.testRequested && (await canTestCampaign(campaign.organizationId));

  const latestVersion = await prisma.campaignVersion.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { versionNumber: "desc" },
  });
  if (!latestVersion) return { ok: false, reason: "not_active" };

  const userAgent = (await headers()).get("user-agent");
  const { deviceType, browser, os } = parseUserAgent(userAgent);

  // A verificação do limite de participação e a criação da participação têm
  // de acontecer na MESMA transação serializável: se corressem em passos
  // separados, dois pedidos concorrentes do mesmo visitante (dois
  // separadores, duplo clique) podiam ambos ler "abaixo do limite" antes de
  // qualquer um gravar a sua participação — contornando "uma participação
  // total/dia/hora" (secção 16). Ver `createParticipationIfAllowed`.
  const result = await createParticipationIfAllowed({
    organizationId: campaign.organizationId,
    campaignId: campaign.id,
    campaignVersionId: latestVersion.id,
    campaignType: campaign.type,
    participationLimitType: campaign.participationLimitType,
    participationCustomMax: campaign.participationCustomMax,
    dedupStrategies: campaign.dedupStrategies,
    quizMaxAttempts: campaign.quizConfig?.maxAttempts ?? null,
    idempotencyKey: input.idempotencyKey,
    isTest,
    cookieId,
    ip,
    sessionId: input.sessionId,
    source: input.source,
    utm: input.utm,
    deviceType,
    browser,
    os,
  });

  if (result.kind === "blocked") {
    await recordEvent(campaign.id, "PARTICIPATION_BLOCKED", isTest, input.sessionId, {
      reason: "limit",
    });
    return { ok: false, reason: "limit_reached" };
  }

  if (result.kind === "created") {
    await recordEvent(campaign.id, "GAME_STARTED", isTest, input.sessionId);
  }

  return {
    ok: true,
    participationId: result.participation.id,
    isTest: result.participation.isTest,
  };
}

export interface SubmitLeadFormInput {
  participationId: string;
  values: Record<string, string>;
  consents: Record<string, boolean>;
  honeypot?: string;
}

export type SubmitLeadFormResult =
  { ok: true } | { ok: false; reason: "duplicate" | "invalid" | "bot" };

export async function submitLeadFormAction(
  input: SubmitLeadFormInput,
): Promise<SubmitLeadFormResult> {
  const ip = await getRequestIp();
  // Sem IP, usa o id da participação (único por submissão) em vez de um
  // balde "unknown" partilhado por todos os visitantes sem IP detetável.
  const rateLimit = await checkRateLimit(`leadform:${ip ?? input.participationId}`, 30, 3600);
  if (!rateLimit.allowed) return { ok: false, reason: "invalid" };

  const participation = await prisma.participation.findUnique({
    where: { id: input.participationId },
    include: {
      campaign: {
        include: {
          leadForm: { include: { fields: true, consentDefinitions: true } },
        },
      },
    },
  });
  if (!participation?.campaign.leadForm) return { ok: false, reason: "invalid" };

  if (input.honeypot) {
    // Bot detetado — finge sucesso sem gravar nada real (secção 25).
    await recordEvent(
      participation.campaignId,
      "PARTICIPATION_BLOCKED",
      participation.isTest,
      participation.sessionId,
      {
        reason: "honeypot",
      },
    );
    return { ok: true };
  }

  const {
    leadForm,
    dedupStrategies,
    minAge,
    organizationId,
    id: campaignId,
  } = participation.campaign;

  for (const field of leadForm.fields) {
    if (!field.required) continue;
    // Uma checkbox desmarcada é serializada como a string "false", que não é
    // vazia — sem este caso especial, `!"false".trim()` avalia a falso e a
    // validação de obrigatoriedade era ignorada (ex.: aceitação de
    // regulamento marcada como obrigatória podia ser submetida desmarcada).
    if (field.type === "CHECKBOX") {
      if (input.values[field.internalKey] !== "true") return { ok: false, reason: "invalid" };
      continue;
    }
    if (!input.values[field.internalKey]?.trim()) {
      return { ok: false, reason: "invalid" };
    }
  }
  for (const consent of leadForm.consentDefinitions) {
    if (consent.required && !input.consents[consent.id]) {
      return { ok: false, reason: "invalid" };
    }
  }

  const emailField = leadForm.fields.find((f) => f.type === "EMAIL");
  const phoneField = leadForm.fields.find((f) => f.type === "PHONE");
  const birthDateField = leadForm.fields.find((f) => f.type === "BIRTH_DATE");
  const email = emailField ? input.values[emailField.internalKey]?.trim() || undefined : undefined;
  const phone = phoneField ? input.values[phoneField.internalKey]?.trim() || undefined : undefined;

  if (minAge != null) {
    // Falha fechado: se a campanha exige idade mínima mas não há campo de
    // data de nascimento configurado (ou foi deixado em branco/inválido),
    // a idade não pode ser confirmada — bloquear em vez de deixar passar
    // silenciosamente (secção 16: validar idade mínima antes do jogo).
    const raw = birthDateField ? input.values[birthDateField.internalKey] : undefined;
    const birthDate = raw ? new Date(raw) : null;
    const age =
      birthDate && !Number.isNaN(birthDate.getTime())
        ? Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;
    if (age == null || age < minAge) {
      return { ok: false, reason: "invalid" };
    }
  }

  if (!participation.isTest && (email || phone)) {
    const allowed = await checkParticipationAllowed(prisma, {
      organizationId,
      campaignId,
      limitType: participation.campaign.participationLimitType,
      customMax: participation.campaign.participationCustomMax,
      dedupStrategies,
      email,
      phone,
      now: new Date(),
    });
    if (!allowed) return { ok: false, reason: "duplicate" };
  }

  const firstNameField = leadForm.fields.find(
    (f) => f.type === "FIRST_NAME" || f.type === "FULL_NAME",
  );
  const lastNameField = leadForm.fields.find((f) => f.type === "LAST_NAME");

  const participant = await prisma.participant.update({
    where: { id: participation.participantId ?? "" },
    data: {
      email: email ?? undefined,
      phone: phone ?? undefined,
      firstName: firstNameField ? input.values[firstNameField.internalKey] || undefined : undefined,
      lastName: lastNameField ? input.values[lastNameField.internalKey] || undefined : undefined,
    },
  });

  await prisma.$transaction([
    prisma.participation.update({
      where: { id: input.participationId },
      data: { leadFormResponse: input.values, participantId: participant.id },
    }),
    ...leadForm.consentDefinitions.map((consent) =>
      prisma.consentRecord.create({
        data: {
          participationId: input.participationId,
          consentDefinitionId: consent.id,
          status: input.consents[consent.id] ? "GRANTED" : "DECLINED",
          text: consent.text,
          version: consent.version,
        },
      }),
    ),
  ]);

  await recordEvent(
    campaignId,
    "LEAD_FORM_SUBMITTED",
    participation.isTest,
    participation.sessionId,
  );

  return { ok: true };
}

export interface MemorySubmitInput {
  participationId: string;
  attempts: number;
  pairsFound: number;
  timeSeconds: number;
}

export interface MemorySubmitResult {
  score: number;
  completed: boolean;
}

export async function submitMemoryResultAction(
  input: MemorySubmitInput,
): Promise<MemorySubmitResult> {
  const rateLimit = await checkRateLimit(`submit:${input.participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const participation = await prisma.participation.findUniqueOrThrow({
    where: { id: input.participationId },
    include: {
      campaign: { include: { memoryConfig: { include: { pairs: true } } } },
      memoryResult: true,
    },
  });

  if (participation.memoryResult) {
    return {
      score: participation.memoryResult.score,
      completed: participation.memoryResult.completed,
    };
  }

  const config = participation.campaign.memoryConfig;
  if (!config) throw new Error("Jogo da Memória não configurado para esta campanha.");

  const result = computeMemoryScore({
    pairsTotal: config.pairs.length,
    pairsFound: input.pairsFound,
    attempts: input.attempts,
    timeSeconds: input.timeSeconds,
    config: {
      pointsPerPair: config.pointsPerPair,
      penaltyPerMistake: config.penaltyPerMistake,
      speedBonusEnabled: config.speedBonusEnabled,
      timeLimitSeconds: config.timeLimitSeconds,
      maxAttempts: config.maxAttempts,
    },
  });

  await prisma.$transaction([
    prisma.memoryResult.create({
      data: {
        participationId: input.participationId,
        timeSeconds: result.timeSeconds,
        attempts: result.attempts,
        pairsFound: result.pairsFound,
        score: result.score,
        completed: result.completed,
      },
    }),
    prisma.participation.update({
      where: { id: input.participationId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        resultSummary: result as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  await recordEvent(
    participation.campaignId,
    "GAME_COMPLETED",
    participation.isTest,
    participation.sessionId,
  );

  return { score: result.score, completed: result.completed };
}

export async function spinWheelAction(participationId: string): Promise<WheelSpinResult> {
  const rateLimit = await checkRateLimit(`submit:${participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  try {
    const result = await drawAndAwardPrize(participationId, new Date());
    const participation = await prisma.participation.findUnique({ where: { id: participationId } });
    if (participation) {
      await recordEvent(
        participation.campaignId,
        "GAME_COMPLETED",
        participation.isTest,
        participation.sessionId,
      );
      if (result.prize) {
        await recordEvent(
          participation.campaignId,
          "PRIZE_AWARDED",
          participation.isTest,
          participation.sessionId,
        );
      }
    }
    return result;
  } catch (error) {
    if (error instanceof NoEligibleSegmentsError) {
      const participation = await prisma.participation.findUnique({
        where: { id: participationId },
      });
      if (participation) {
        await recordEvent(
          participation.campaignId,
          "PARTICIPATION_BLOCKED",
          participation.isTest,
          participation.sessionId,
          {
            reason: "no_eligible_segments",
          },
        );
      }
    }
    throw error;
  }
}

export async function submitQuizAction(
  participationId: string,
  submissions: QuizPlayerSubmission[],
  timeSeconds: number,
): Promise<QuizPlayerResult> {
  const rateLimit = await checkRateLimit(`submit:${participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const participation = await prisma.participation.findUniqueOrThrow({
    where: { id: participationId },
    include: {
      campaign: {
        include: {
          quizConfig: {
            include: { questions: { include: { answers: true } }, resultProfiles: true },
          },
        },
      },
      quizResponse: true,
    },
  });

  const config = participation.campaign.quizConfig;
  if (!config) throw new Error("Quiz não configurado para esta campanha.");

  if (participation.quizResponse) {
    const profile = participation.quizResponse.resultProfileId
      ? config.resultProfiles.find((p) => p.id === participation.quizResponse!.resultProfileId)
      : null;
    return {
      totalScore: participation.quizResponse.totalScore,
      maxPossibleScore: config.questions.reduce((sum, q) => sum + q.points, 0),
      percentage: participation.quizResponse.percentage,
      passed: participation.quizResponse.passed,
      resultProfile: profile
        ? {
            title: profile.title,
            description: profile.description,
            ctaLabel: profile.ctaLabel,
            ctaUrl: profile.ctaUrl,
          }
        : null,
    };
  }

  const scored = computeQuizScore(
    config.questions.map((q) => ({
      id: q.id,
      points: q.points,
      correctAnswerIds: q.answers.filter((a) => a.isCorrect).map((a) => a.id),
    })),
    submissions,
    timeSeconds,
    {
      penaltyPerWrong: config.penaltyPerWrong,
      speedBonusEnabled: config.speedBonusEnabled,
      totalTimeLimitSeconds: config.totalTimeLimitSeconds,
      minPassPercentage: config.minPassPercentage,
    },
  );
  const profileId = matchResultProfile(scored.percentage, config.resultProfiles);
  const profile = config.resultProfiles.find((p) => p.id === profileId) ?? null;

  await prisma.$transaction([
    prisma.quizResponse.create({
      data: {
        participationId,
        answers: submissions as unknown as Prisma.InputJsonValue,
        totalScore: scored.totalScore,
        percentage: scored.percentage,
        passed: scored.passed,
        resultProfileId: profileId,
        timeSeconds,
      },
    }),
    prisma.participation.update({
      where: { id: participationId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        resultSummary: scored as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  await recordEvent(
    participation.campaignId,
    "GAME_COMPLETED",
    participation.isTest,
    participation.sessionId,
  );

  return {
    totalScore: scored.totalScore,
    maxPossibleScore: scored.maxPossibleScore,
    percentage: scored.percentage,
    passed: scored.passed,
    resultProfile: profile
      ? {
          title: profile.title,
          description: profile.description,
          ctaLabel: profile.ctaLabel,
          ctaUrl: profile.ctaUrl,
        }
      : null,
  };
}
