import { z } from "zod";

/**
 * Validação dos argumentos das server actions do jogo público.
 *
 * Uma server action aceita qualquer valor serializável, não o tipo
 * TypeScript declarado. Sem isto, um `token` em falta chegava ao Prisma como
 * `undefined` — que ele ignora no `where` — e um objeto chegava como filtro
 * (`{ not: "" }`): a verificação de posse deixava de filtrar e a consulta
 * podia apanhar a participação de outra pessoa, de qualquer organização.
 * Todas as entradas são estritas (sem chaves extra) e limitadas em tamanho.
 */

const id = z.string().min(1).max(64);

export const participationRefSchema = z.strictObject({
  participationId: id,
  token: z.uuid(),
});

export const startParticipationSchema = z.strictObject({
  campaignId: id,
  idempotencyKey: z.uuid(),
  sessionId: z.uuid(),
  testRequested: z.boolean(),
  utm: z
    .strictObject({
      source: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      campaign: z.string().max(200).optional(),
      content: z.string().max(200).optional(),
      term: z.string().max(200).optional(),
    })
    .optional(),
  source: z.string().max(2000).optional(),
});

/** Retomar a participação depois de recarregar a página. */
export const resumeParticipationSchema = z.strictObject({
  campaignId: id,
  ref: participationRefSchema,
  testRequested: z.boolean(),
});

export const submitLeadFormSchema = z.strictObject({
  ref: participationRefSchema,
  values: z.record(z.string().max(100), z.string().max(5000)),
  consents: z.record(z.string().max(64), z.boolean()),
  honeypot: z.string().max(1000).optional(),
});

export const memorySubmitSchema = z.strictObject({
  ref: participationRefSchema,
  attempts: z.number().int().min(0).max(100_000),
  pairsFound: z.number().int().min(0).max(1000),
  timeSeconds: z.number().min(0).max(86_400),
});

export const quizSubmissionsSchema = z
  .array(
    z.strictObject({
      questionId: id,
      selectedAnswerIds: z.array(id).max(50),
    }),
  )
  .max(500);

/** Tempo total do quiz: nunca negativo (dava bónus de rapidez indevido). */
export const quizTimeSecondsSchema = z.number().min(0).max(86_400);

export const analyticsEventSchema = z.strictObject({
  campaignId: id,
  type: z.enum(["CAMPAIGN_VIEWED", "START_CLICKED", "CTA_CLICKED"]),
  isTest: z.boolean(),
  sessionId: z.uuid().optional(),
});
