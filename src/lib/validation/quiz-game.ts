import { z } from "zod";

export const questionTypeSchema = z.enum([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "TRUE_FALSE",
  "IMAGE_CHOICE",
]);

export const quizConfigSchema = z.object({
  questionsPerParticipation: z.coerce.number().int().min(1).optional(),
  randomizeQuestionOrder: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  randomizeAnswerOrder: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  totalTimeLimitSeconds: z.coerce.number().int().min(0).optional(),
  perQuestionTimeLimitSeconds: z.coerce.number().int().min(0).optional(),
  penaltyPerWrong: z.coerce.number().int().min(0).max(1000),
  speedBonusEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  allowGoBack: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  showProgress: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  showCorrectAnswer: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  showExplanation: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  minPassPercentage: z.coerce.number().int().min(0).max(100).optional(),
  maxAttempts: z.coerce.number().int().min(0).optional(),
});

export const addQuestionSchema = z.object({
  type: questionTypeSchema,
  title: z.string().trim().min(1, "O título é obrigatório.").max(300),
});

export const updateQuestionSchema = z.object({
  title: z.string().trim().min(1).max(300),
  supportText: z.string().trim().max(500).optional().or(z.literal("")),
  imageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  points: z.coerce.number().int().min(0).max(1000),
  timeLimitSeconds: z.coerce.number().int().min(0).optional(),
  explanation: z.string().trim().max(1000).optional().or(z.literal("")),
  required: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  immediateFeedback: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export const addAnswerSchema = z.object({
  text: z.string().trim().max(300).optional().or(z.literal("")),
  imageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  isCorrect: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export const resultProfileSchema = z.object({
  minPercentage: z.coerce.number().int().min(0).max(100),
  maxPercentage: z.coerce.number().int().min(0).max(100),
  title: z.string().trim().min(1, "O título é obrigatório.").max(150),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  imageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  ctaLabel: z.string().trim().max(60).optional().or(z.literal("")),
  ctaUrl: z.string().trim().max(500).optional().or(z.literal("")),
});
