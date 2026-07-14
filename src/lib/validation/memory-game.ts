import { z } from "zod";

export const memoryPairKindSchema = z.enum([
  "SAME_IMAGE",
  "DIFFERENT_IMAGE_MATCH",
  "IMAGE_TEXT",
  "TEXT_TEXT",
]);

export const memoryConfigSchema = z.object({
  columns: z.coerce.number().int().min(2).max(8),
  randomizeOrder: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  cardAspectRatio: z.string().trim().min(1).max(20),
  cardGapPx: z.coerce.number().int().min(0).max(64),
  timeLimitSeconds: z.coerce.number().int().min(0).optional(),
  maxAttempts: z.coerce.number().int().min(0).optional(),
  pointsPerPair: z.coerce.number().int().min(0).max(1000),
  penaltyPerMistake: z.coerce.number().int().min(0).max(1000),
  speedBonusEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  previewSeconds: z.coerce.number().int().min(0).max(30).optional(),
  soundEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  rankingEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  rankingMaxEntries: z.coerce.number().int().min(1).max(1000).optional(),
  rankingAnonymize: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  cardBackMediaId: z.string().trim().max(60).optional().or(z.literal("")),
});

export const memoryPairSchema = z.object({
  kind: memoryPairKindSchema,
  cardAMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  cardAText: z.string().trim().max(200).optional().or(z.literal("")),
  cardAAltText: z.string().trim().max(200).optional().or(z.literal("")),
  cardBMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  cardBText: z.string().trim().max(200).optional().or(z.literal("")),
  cardBAltText: z.string().trim().max(200).optional().or(z.literal("")),
});
