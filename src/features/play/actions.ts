"use server";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { checkParticipationAllowed } from "@/features/play/limits";
import { extractLeadIdentity, isPlausiblePhone } from "@/features/play/identity";
import { openGameGate, parseParticipationRef, tokenMatches } from "@/features/play/participation-access";
import {
  effectiveLeadFormPosition,
  participationLeadFormPosition,
  projectWheelOutcome,
  visibleFieldCount,
  type LeadFormShape,
} from "@/features/play/reveal";
import { toPublicLeadForm } from "@/features/play/lead-form-definition";
import { effectiveGameSeconds } from "@/features/play/game-clock";
import type { GameActionResponse, ParticipationRef, PublicLeadFormDefinition } from "@/features/play/types";
import { runSerializable } from "@/lib/db/transaction-retry";
import {
  analyticsEventSchema,
  memorySubmitSchema,
  participationRefSchema,
  quizSubmissionsSchema,
  quizTimeSecondsSchema,
  resumeParticipationSchema,
  startParticipationSchema,
  submitLeadFormSchema,
} from "@/lib/validation/play";
import { releaseParticipationReservation, settleReservation } from "@/features/prizes/reservation";
import { createParticipationIfAllowed } from "@/features/play/create-participation";
import { getOrCreateVisitorCookieId } from "@/features/play/cookie";
import { getRequestIp } from "@/lib/security/request-ip";
import { parseUserAgent } from "@/features/play/user-agent";
import { canTestCampaign } from "@/features/play/test-mode";
import { headers } from "next/headers";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { isAgeVerifiable } from "@/features/publishing/age-check";
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

type LeadFormForShape = {
  position: LeadFormShape["position"];
  fields: readonly { type: string }[];
  consentDefinitions: readonly unknown[];
} | null;

function shapeOf(form: LeadFormForShape): LeadFormShape | null {
  return form
    ? { position: form.position, fieldCount: visibleFieldCount(form.fields), consentCount: form.consentDefinitions.length }
    : null;
}

const leadFormContent = {
  include: {
    fields: { orderBy: { order: "asc" } },
    consentDefinitions: { orderBy: { order: "asc" } },
  },
} as const;

export async function recordAnalyticsEventAction(
  campaignId: string,
  type: "CAMPAIGN_VIEWED" | "START_CLICKED" | "CTA_CLICKED",
  isTest: boolean,
  sessionId?: string,
): Promise<void> {
  // Server action pública: os argumentos chegam como o browser os mandar.
  // Antes, qualquer pessoa gravava eventos para qualquer campanha — rascunhos,
  // outras organizações — e escolhia se contavam como teste ou como reais,
  // adulterando visualizações, taxa de início e CTA (§20, §31).
  const parsed = analyticsEventSchema.safeParse({ campaignId, type, isTest, sessionId });
  if (!parsed.success) return;

  const campaign = await prisma.campaign.findUnique({
    where: { id: parsed.data.campaignId },
    select: { id: true, organizationId: true, status: true, scheduleStartAt: true, scheduleEndAt: true },
  });
  if (!campaign || getEffectivePublicState(campaign) !== "active") return;

  // Limite largo por IP: um quiosque num evento gera muitas visitas; o
  // objetivo é travar a injeção em massa, não visitas reais.
  const ip = await getRequestIp();
  const rateLimit = await checkRateLimit(
    `analytics:${campaign.id}:${ip ?? parsed.data.sessionId ?? "anon"}`,
    600,
    3600,
  );
  if (!rateLimit.allowed) return;

  // O modo de teste é decidido no servidor, como no início da participação.
  const testMode = parsed.data.isTest && (await canTestCampaign(campaign.organizationId));
  await recordEvent(campaign.id, parsed.data.type, testMode, parsed.data.sessionId);
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
  | { ok: true; participationId: string; isTest: boolean; leadForm: PublicLeadFormDefinition | null }
  | { ok: false; reason: "not_active" | "limit_reached" | "rate_limited" | "not_found" };

export async function startParticipationAction(
  rawInput: StartParticipationInput,
): Promise<StartParticipationResult> {
  // Server action pública: os argumentos chegam como o browser os mandar
  // (ver src/lib/validation/play.ts).
  const parsedInput = startParticipationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { ok: false, reason: "not_found" };
  const input = parsedInput.data;

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
      minAge: true,
      quizConfig: { select: { maxAttempts: true } },
      leadForm: leadFormContent,
    },
  });
  if (!campaign) return { ok: false, reason: "not_found" };

  const effectiveState = getEffectivePublicState(campaign);
  if (effectiveState !== "active") return { ok: false, reason: "not_active" };

  const liveShape = shapeOf(campaign.leadForm);
  const effectivePosition = effectiveLeadFormPosition(liveShape);

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
  // O clique em "Jogar" (§31) fica registado aqui, e não numa ação à parte do
  // browser: as server actions de uma página correm uma de cada vez, e o
  // início da participação ficava à espera do registo do evento.
  await recordEvent(campaign.id, "START_CLICKED", isTest, input.sessionId);

  // Idade mínima sem data de nascimento no formulário não se verifica: falha
  // fechado (§16) em vez de deixar jogar sem confirmar. A publicação e o
  // editor de uma campanha publicada já o recusam; isto cobre campanhas
  // publicadas antes. Depois do rate limit (cada pedido grava um evento) e
  // do modo de teste (um teste não conta como bloqueio real).
  const ageForm = campaign.leadForm
    ? {
        position: campaign.leadForm.position,
        fields: campaign.leadForm.fields,
        consentCount: campaign.leadForm.consentDefinitions.length,
      }
    : null;
  if (!isAgeVerifiable(campaign.minAge, ageForm)) {
    await recordEvent(campaign.id, "PARTICIPATION_BLOCKED", isTest, input.sessionId, { reason: "age_unverifiable" });
    return { ok: false, reason: "not_active" };
  }

  // Só o id: o snapshot (JSON da campanha inteira) não é preciso aqui.
  const latestVersion = await prisma.campaignVersion.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { versionNumber: "desc" },
    select: { id: true },
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
    leadFormPosition: effectivePosition,
  });

  if (result.kind === "conflict") return { ok: false, reason: "not_found" };

  if (result.kind === "blocked") {
    await recordEvent(campaign.id, "PARTICIPATION_BLOCKED", isTest, input.sessionId, {
      reason: "limit",
    });
    return { ok: false, reason: "limit_reached" };
  }

  if (result.kind === "created") {
    await recordEvent(campaign.id, "GAME_STARTED", isTest, input.sessionId);
  }

  // O formulário segue a posição fixada nesta participação (num retry, a
  // que ficou gravada no primeiro pedido), com os campos atuais.
  const position = participationLeadFormPosition(result.participation.leadFormPosition, liveShape);
  return {
    ok: true,
    participationId: result.participation.id,
    isTest: result.participation.isTest,
    leadForm: toPublicLeadForm(campaign.leadForm, position),
  };
}

/**
 * Participações terminadas há mais do que isto já não são retomadas. Não é
 * exportada: um ficheiro "use server" só pode exportar funções assíncronas.
 */
const RESUME_COMPLETED_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface ResumeParticipationInput {
  campaignId: string;
  ref: ParticipationRef;
  testRequested: boolean;
}

export type ResumeParticipationResult =
  | {
      ok: true;
      participationId: string;
      isTest: boolean;
      leadForm: PublicLeadFormDefinition | null;
      leadSubmitted: boolean;
      completed: boolean;
    }
  /**
   * "retry": não foi possível verificar agora (rate limit) e a participação
   * pode continuar válida; "gone": já não se retoma, começa-se outra.
   */
  | { ok: false; reason: "retry" | "gone" };

const GONE = { ok: false, reason: "gone" } as const;

/**
 * Retoma a participação do separador depois de recarregar a página (§7:
 * navegação sem perda de dados). Antes, um F5 criava uma participação nova
 * — ou esbarrava no limite de participação, que penalizava quem tinha
 * participado uma só vez — e o prémio sorteado ficava inacessível.
 *
 * Só leitura: não grava, não emite eventos e não conta para os limites (a
 * participação já conta). Exige o token de posse, que só o separador que a
 * iniciou tem (sessionStorage).
 */
export async function resumeParticipationAction(
  rawInput: ResumeParticipationInput,
): Promise<ResumeParticipationResult> {
  const parsed = resumeParticipationSchema.safeParse(rawInput);
  if (!parsed.success) return GONE;
  const input = parsed.data;

  const ip = await getRequestIp();
  // Largo: num evento, muitos visitantes partilham o IP do wi-fi.
  const rateLimit = await checkRateLimit(`resume:${input.campaignId}:${ip ?? input.ref.participationId}`, 300, 3600);
  if (!rateLimit.allowed) return { ok: false, reason: "retry" };

  const participation = await prisma.participation.findUnique({
    where: { id: input.ref.participationId },
    select: {
      id: true,
      idempotencyKey: true,
      campaignId: true,
      isTest: true,
      status: true,
      completedAt: true,
      resultSummary: true,
      leadFormResponse: true,
      leadFormPosition: true,
      campaign: {
        select: {
          organizationId: true,
          status: true,
          scheduleStartAt: true,
          scheduleEndAt: true,
          leadForm: leadFormContent,
        },
      },
    },
  });
  if (!participation || !tokenMatches(participation.idempotencyKey, input.ref.token)) return GONE;
  if (participation.campaignId !== input.campaignId || participation.status === "BLOCKED") return GONE;

  // O modo (teste ou real) tem de coincidir com o da página, decidido no
  // servidor como no início.
  const testMode = input.testRequested && (await canTestCampaign(participation.campaign.organizationId));
  if (participation.isTest !== testMode) return GONE;

  const completed = participation.resultSummary !== null;
  if (!completed && getEffectivePublicState(participation.campaign) !== "active") return GONE;
  // Num quiosque, a pessoa seguinte no mesmo separador não vê o resultado da
  // anterior para sempre.
  if (completed && participation.completedAt && Date.now() - participation.completedAt.getTime() > RESUME_COMPLETED_WINDOW_MS) {
    return GONE;
  }

  const position = participationLeadFormPosition(participation.leadFormPosition, shapeOf(participation.campaign.leadForm));
  return {
    ok: true,
    participationId: participation.id,
    isTest: participation.isTest,
    leadForm: toPublicLeadForm(participation.campaign.leadForm, position),
    leadSubmitted: participation.leadFormResponse !== null,
    completed,
  };
}

/**
 * Regista no servidor o início do jogo (memória e quiz), quando o tabuleiro
 * ou a primeira pergunta aparecem. Idempotente: o início nunca é reescrito,
 * por isso recarregar a página não repõe o relógio (ver game-clock.ts).
 */
export async function beginGameAction(rawRef: ParticipationRef): Promise<{ ok: boolean }> {
  const parsed = participationRefSchema.safeParse(rawRef);
  if (!parsed.success) return { ok: false };

  const rateLimit = await checkRateLimit(`begin:${parsed.data.participationId}`, 20, 60);
  if (!rateLimit.allowed) return { ok: false };

  const access = await openGameGate(parsed.data);
  if (!access.ok || access.gate.campaignType === "WHEEL") return { ok: false };

  await prisma.gameSession.upsert({
    where: { participationId: access.gate.participationId },
    create: { participationId: access.gate.participationId },
    update: {},
  });
  return { ok: true };
}

/**
 * Início do jogo no servidor. Sem GameSession (o pedido de início falhou) vale
 * só o tempo do browser: o início da participação incluía o formulário e o
 * ecrã intermédio, e um jogador honesto ficava com "Tempo esgotado".
 */
async function gameStartedAt(participationId: string): Promise<Date | null> {
  const session = await prisma.gameSession.findUnique({
    where: { participationId },
    select: { startedAt: true },
  });
  return session?.startedAt ?? null;
}

export interface SubmitLeadFormInput {
  ref: ParticipationRef;
  values: Record<string, string>;
  consents: Record<string, boolean>;
  honeypot?: string;
}

export type SubmitLeadFormResult =
  { ok: true } | { ok: false; reason: "duplicate" | "invalid" | "phone" | "bot" };

export async function submitLeadFormAction(
  rawInput: SubmitLeadFormInput,
): Promise<SubmitLeadFormResult> {
  // Server action pública: sem validar a forma, um token em falta ou em
  // objeto transformava-se num filtro do Prisma (ver validation/play.ts).
  const parsedInput = submitLeadFormSchema.safeParse(rawInput);
  if (!parsedInput.success) return { ok: false, reason: "invalid" };
  const input = parsedInput.data;

  const ip = await getRequestIp();
  // Sem IP, usa o id da participação (único por submissão) em vez de um
  // balde "unknown" partilhado por todos os visitantes sem IP detetável.
  const rateLimit = await checkRateLimit(`leadform:${ip ?? input.ref.participationId}`, 30, 3600);
  if (!rateLimit.allowed) return { ok: false, reason: "invalid" };

  // Posse: sem o token certo, não se associa uma lead à participação de outra
  // pessoa (ver ParticipationRef).
  const participation = await prisma.participation.findUnique({
    where: { id: input.ref.participationId },
    include: {
      campaign: {
        include: {
          leadForm: { include: { fields: true, consentDefinitions: true } },
        },
      },
    },
  });
  if (!participation || !tokenMatches(participation.idempotencyKey, input.ref.token)) {
    return { ok: false, reason: "invalid" };
  }

  // Já submetido: não se grava outra vez nem se duplicam os registos de
  // consentimento. O fluxo público pode repetir o envio depois de uma falha
  // de rede e tem de receber sucesso.
  if (participation.leadFormResponse !== null) return { ok: true };

  // Sem formulário para esta participação (desligado, ou sem campos nem
  // consentimentos): nada a gravar, e não é uma lead (§20, §24). Um browser
  // com a página antiga tem de conseguir avançar.
  const position = participationLeadFormPosition(
    participation.leadFormPosition,
    shapeOf(participation.campaign.leadForm),
  );
  if (!participation.campaign.leadForm || position === "NONE") return { ok: true };

  if (input.honeypot) {
    // Bot detetado — finge sucesso sem gravar nada real (secção 25). Como
    // nada fica gravado, os portões do jogo continuam fechados para ele, e
    // um prémio reservado volta ao stock.
    await runSerializable((tx) => releaseParticipationReservation(tx, participation.id, "BOT", new Date()));
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
    // O valor de um campo oculto vem do servidor (abaixo), nunca do browser.
    if (!field.required || field.type === "HIDDEN") continue;
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
  // Um telefone que não é um número (menos de 6 ou mais de 15 dígitos) não
  // serve para contactar nem para o controlo de duplicados.
  for (const field of leadForm.fields) {
    const value = input.values[field.internalKey]?.trim();
    if (field.type === "PHONE" && value && !isPlausiblePhone(value)) return { ok: false, reason: "phone" };
  }
  for (const consent of leadForm.consentDefinitions) {
    // O de marketing nunca é obrigatório, mesmo que tenha sido gravado assim.
    if (consent.required && !consent.isMarketing && !input.consents[consent.id]) {
      return { ok: false, reason: "invalid" };
    }
  }

  const birthDateField = leadForm.fields.find((f) => f.type === "BIRTH_DATE");
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

  // Minimização (secção 24): só se guardam os campos que o formulário tem.
  // Um campo oculto não se mostra nem se preenche: leva o valor predefinido,
  // e o que o browser mandar para ele é ignorado.
  const visibleKeys = new Set(leadForm.fields.filter((f) => f.type !== "HIDDEN").map((f) => f.internalKey));
  const values: Record<string, string> = Object.fromEntries(
    Object.entries(input.values).filter(([key]) => visibleKeys.has(key)),
  );
  for (const field of leadForm.fields) {
    if (field.type === "HIDDEN" && field.defaultValue) values[field.internalKey] = field.defaultValue;
  }
  const identity = extractLeadIdentity(leadForm.fields, values);

  // Controlo de duplicados e gravação na mesma transação serializável: duas
  // submissões concorrentes com o mesmo e-mail não passam ambas a
  // verificação. A gravação só acontece se a participação ainda não tiver
  // formulário, por isso um duplo clique não duplica os consentimentos.
  const outcome = await runSerializable(async (tx) => {
    const now = new Date();
    if (!participation.isTest && (identity.email || identity.phone)) {
      const allowed = await checkParticipationAllowed(tx, {
        organizationId,
        campaignId,
        limitType: participation.campaign.participationLimitType,
        customMax: participation.campaign.participationCustomMax,
        dedupStrategies,
        email: identity.email,
        phone: identity.phone,
        excludeParticipationId: participation.id,
        now,
      });
      if (!allowed) {
        // Lead recusada: o prémio reservado para ela volta ao stock.
        await releaseParticipationReservation(tx, participation.id, "DUPLICATE", now);
        return { status: "duplicate" as const };
      }
    }

    const saved = await tx.participation.updateMany({
      where: { id: participation.id, leadFormResponse: { equals: Prisma.DbNull } },
      data: { leadFormResponse: values, ...identity },
    });
    if (saved.count === 0) return { status: "already_saved" as const };

    if (leadForm.consentDefinitions.length > 0) {
      await tx.consentRecord.createMany({
        data: leadForm.consentDefinitions.map((consent) => ({
          participationId: participation.id,
          consentDefinitionId: consent.id,
          status: input.consents[consent.id] ? ("GRANTED" as const) : ("DECLINED" as const),
          text: consent.text,
          version: consent.version,
          // Origem do consentimento (§11): a página pública da campanha.
          source: `play:${participation.campaign.slug}`,
        })),
      });
    }
    // Lead aceite: o prémio reservado no sorteio passa a atribuído, na mesma
    // transação que grava a lead (ver features/prizes/reservation.ts).
    const prize = await settleReservation(tx, participation.id, now);
    return { status: "saved" as const, prize };
  });

  if (outcome.status === "duplicate") return { ok: false, reason: "duplicate" };

  if (outcome.status === "saved") {
    await recordEvent(
      campaignId,
      "LEAD_FORM_SUBMITTED",
      participation.isTest,
      participation.sessionId,
    );
    if (outcome.prize === "confirmed") {
      await recordEvent(campaignId, "PRIZE_AWARDED", participation.isTest, participation.sessionId);
    }
  }

  return { ok: true };
}

export interface MemorySubmitInput {
  ref: ParticipationRef;
  attempts: number;
  pairsFound: number;
  timeSeconds: number;
}

export interface MemorySubmitResult {
  score: number;
  completed: boolean;
}

export type StoredGameResult =
  | { kind: "MEMORY"; result: MemorySubmitResult }
  | { kind: "QUIZ"; result: QuizPlayerResult };

interface QuizProfileForClient {
  id: string;
  title: string;
  description: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

function toClientProfile(profile: QuizProfileForClient | null | undefined): QuizPlayerResult["resultProfile"] {
  return profile
    ? { title: profile.title, description: profile.description, ctaLabel: profile.ctaLabel, ctaUrl: profile.ctaUrl }
    : null;
}

function storedQuizResult(
  response: { totalScore: number; percentage: number; passed: boolean | null; resultProfileId: string | null },
  config: { questions: readonly { points: number }[]; resultProfiles: readonly QuizProfileForClient[] },
): QuizPlayerResult {
  const profile = response.resultProfileId ? config.resultProfiles.find((p) => p.id === response.resultProfileId) : null;
  return {
    totalScore: response.totalScore,
    maxPossibleScore: config.questions.reduce((sum, q) => sum + q.points, 0),
    percentage: response.percentage,
    passed: response.passed,
    resultProfile: toClientProfile(profile),
  };
}

export async function submitMemoryResultAction(
  rawInput: MemorySubmitInput,
): Promise<GameActionResponse<MemorySubmitResult>> {
  const parsedInput = memorySubmitSchema.safeParse(rawInput);
  if (!parsedInput.success) return { status: "blocked", reason: "not_found" };
  const input = parsedInput.data;

  const rateLimit = await checkRateLimit(`submit:${input.ref.participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const access = await openGameGate(input.ref);
  if (!access.ok) return { status: "blocked", reason: access.reason };
  const { gate } = access;
  if (gate.campaignType !== "MEMORY") return { status: "blocked", reason: "not_found" };

  const reveal = (result: MemorySubmitResult): GameActionResponse<MemorySubmitResult> =>
    gate.policy === "withhold_result" ? { status: "lead_required" } : { status: "revealed", result };

  const participation = await prisma.participation.findUniqueOrThrow({
    where: { id: gate.participationId },
    include: {
      campaign: { include: { memoryConfig: { include: { pairs: true } } } },
      memoryResult: true,
    },
  });

  if (participation.memoryResult) {
    return reveal({
      score: participation.memoryResult.score,
      completed: participation.memoryResult.completed,
    });
  }

  const config = participation.campaign.memoryConfig;
  if (!config) throw new Error("Jogo da Memória não configurado para esta campanha.");

  // O tempo que conta é o maior entre o do browser e o do servidor (ver
  // game-clock.ts); a pré-visualização das cartas não conta para o browser.
  const now = new Date();
  const timeSeconds = effectiveGameSeconds({
    clientSeconds: input.timeSeconds,
    startedAt: await gameStartedAt(gate.participationId),
    now,
    extraGraceSeconds: config.previewSeconds ?? 0,
  });

  const result = computeMemoryScore({
    pairsTotal: config.pairs.length,
    pairsFound: input.pairsFound,
    attempts: input.attempts,
    timeSeconds,
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
        participationId: gate.participationId,
        timeSeconds: result.timeSeconds,
        attempts: result.attempts,
        pairsFound: result.pairsFound,
        score: result.score,
        completed: result.completed,
      },
    }),
    prisma.participation.update({
      where: { id: gate.participationId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        resultSummary: result as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.gameSession.updateMany({ where: { participationId: gate.participationId }, data: { endedAt: now } }),
  ]);

  await recordEvent(gate.campaignId, "GAME_COMPLETED", gate.isTest, gate.sessionId);

  return reveal({ score: result.score, completed: result.completed });
}

export async function spinWheelAction(
  rawRef: ParticipationRef,
): Promise<GameActionResponse<WheelSpinResult>> {
  const ref = parseParticipationRef(rawRef);
  if (!ref) return { status: "blocked", reason: "not_found" };

  const rateLimit = await checkRateLimit(`submit:${ref.participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const access = await openGameGate(ref);
  if (!access.ok) return { status: "blocked", reason: access.reason };
  const { gate } = access;
  if (gate.campaignType !== "WHEEL") return { status: "blocked", reason: "not_found" };

  // "Antes de revelar o resultado": nada se sorteia antes do formulário. Para
  // quem joga é igual — não vê nada até o submeter —, mas assim uma lead
  // recusada (duplicado, idade) ou abandonada não fica com um prémio e um
  // código atribuídos que nunca vai ver.
  if (gate.policy === "withhold_result") return { status: "lead_required" };

  try {
    const result = await drawAndAwardPrize(gate.participationId, new Date());
    // Só a primeira rotação conta: repetir o pedido (incluindo para revelar
    // o resultado depois do formulário) devolve o resultado gravado e não
    // pode gerar eventos duplicados.
    if (!result.alreadyResolved) {
      await recordEvent(gate.campaignId, "GAME_COMPLETED", gate.isTest, gate.sessionId);
    }
    // Um prémio reservado só conta quando a lead é aceite (evento emitido
    // aí); em teste nada é real, mas o evento fica marcado como teste.
    if (result.confirmedNow || (!result.alreadyResolved && result.delivery === "test")) {
      await recordEvent(gate.campaignId, "PRIZE_AWARDED", gate.isTest, gate.sessionId);
    }
    // Projeção explícita: o resultado gravado guarda o id interno do prémio,
    // e tudo o que esta ação devolve chega ao browser tal como está.
    return { status: "revealed", result: projectWheelOutcome(result, gate.policy) };
  } catch (error) {
    if (error instanceof NoEligibleSegmentsError) {
      // Sem nada que possa sair agora (prémios esgotados ou fora do período,
      // sem segmento de recurso): uma resposta que o ecrã sabe mostrar, em
      // vez de um erro.
      await recordEvent(gate.campaignId, "PARTICIPATION_BLOCKED", gate.isTest, gate.sessionId, {
        reason: "no_eligible_segments",
      });
      return { status: "blocked", reason: "no_segments" };
    }
    throw error;
  }
}

export async function submitQuizAction(
  rawRef: ParticipationRef,
  rawSubmissions: QuizPlayerSubmission[],
  rawTimeSeconds: number,
): Promise<GameActionResponse<QuizPlayerResult>> {
  const ref = parseParticipationRef(rawRef);
  const parsedSubmissions = quizSubmissionsSchema.safeParse(rawSubmissions);
  const parsedTime = quizTimeSecondsSchema.safeParse(rawTimeSeconds);
  if (!ref || !parsedSubmissions.success || !parsedTime.success) {
    return { status: "blocked", reason: "not_found" };
  }
  const submissions = parsedSubmissions.data;
  const timeSeconds = parsedTime.data;

  const rateLimit = await checkRateLimit(`submit:${ref.participationId}`, 10, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const access = await openGameGate(ref);
  if (!access.ok) return { status: "blocked", reason: access.reason };
  const { gate } = access;
  if (gate.campaignType !== "QUIZ") return { status: "blocked", reason: "not_found" };

  const reveal = (result: QuizPlayerResult): GameActionResponse<QuizPlayerResult> =>
    gate.policy === "withhold_result" ? { status: "lead_required" } : { status: "revealed", result };

  const participation = await prisma.participation.findUniqueOrThrow({
    where: { id: gate.participationId },
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

  const existing = participation.quizResponse;
  if (existing) return reveal(storedQuizResult(existing, config));

  // O tempo que conta é o maior entre o do browser e o do servidor (ver
  // game-clock.ts): recarregar a página já não repõe o tempo total.
  const now = new Date();
  const effectiveSeconds = effectiveGameSeconds({
    clientSeconds: timeSeconds,
    startedAt: await gameStartedAt(gate.participationId),
    now,
  });

  const scored = computeQuizScore(
    config.questions.map((q) => ({
      id: q.id,
      points: q.points,
      correctAnswerIds: q.answers.filter((a) => a.isCorrect).map((a) => a.id),
    })),
    submissions,
    effectiveSeconds,
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
        participationId: gate.participationId,
        answers: submissions as unknown as Prisma.InputJsonValue,
        totalScore: scored.totalScore,
        percentage: scored.percentage,
        passed: scored.passed,
        resultProfileId: profileId,
        timeSeconds: effectiveSeconds,
      },
    }),
    prisma.participation.update({
      where: { id: gate.participationId },
      data: {
        status: "COMPLETED",
        completedAt: now,
        resultSummary: scored as unknown as Prisma.InputJsonValue,
      },
    }),
    prisma.gameSession.updateMany({ where: { participationId: gate.participationId }, data: { endedAt: now } }),
  ]);

  await recordEvent(gate.campaignId, "GAME_COMPLETED", gate.isTest, gate.sessionId);

  return reveal({
    totalScore: scored.totalScore,
    maxPossibleScore: scored.maxPossibleScore,
    percentage: scored.percentage,
    passed: scored.passed,
    resultProfile: toClientProfile(profile),
  });
}

/**
 * Resultado já gravado da memória ou do quiz, para uma participação retomada:
 * o jogo não volta a aparecer e, com "Antes de revelar o resultado", o
 * resultado só se vê depois do formulário — antes, quem recarregasse nesse
 * formulário dava os dados e nunca via o resultado. Só leitura, com a mesma
 * política de revelação das ações de jogo.
 */
export async function getStoredResultAction(rawRef: ParticipationRef): Promise<GameActionResponse<StoredGameResult>> {
  const ref = parseParticipationRef(rawRef);
  if (!ref) return { status: "blocked", reason: "not_found" };

  const rateLimit = await checkRateLimit(`result:${ref.participationId}`, 30, 60);
  if (!rateLimit.allowed)
    throw new Error("Demasiadas tentativas. Tente novamente dentro de instantes.");

  const access = await openGameGate(ref);
  if (!access.ok) return { status: "blocked", reason: access.reason };
  const { gate } = access;

  const participation = await prisma.participation.findUniqueOrThrow({
    where: { id: gate.participationId },
    select: {
      memoryResult: { select: { score: true, completed: true } },
      quizResponse: { select: { totalScore: true, percentage: true, passed: true, resultProfileId: true } },
      campaign: {
        select: {
          quizConfig: {
            select: {
              questions: { select: { points: true } },
              resultProfiles: { select: { id: true, title: true, description: true, ctaLabel: true, ctaUrl: true } },
            },
          },
        },
      },
    },
  });

  let stored: StoredGameResult | null = null;
  if (gate.campaignType === "MEMORY" && participation.memoryResult) {
    stored = { kind: "MEMORY", result: participation.memoryResult };
  } else if (gate.campaignType === "QUIZ" && participation.quizResponse && participation.campaign.quizConfig) {
    stored = { kind: "QUIZ", result: storedQuizResult(participation.quizResponse, participation.campaign.quizConfig) };
  }
  if (!stored) return { status: "blocked", reason: "not_found" };
  if (gate.policy === "withhold_result") return { status: "lead_required" };
  return { status: "revealed", result: stored };
}
