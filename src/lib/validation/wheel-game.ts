import { z } from "zod";

export const wheelSegmentOutcomeSchema = z.enum(["WIN", "NO_WIN"]);

export const wheelSegmentSchema = z.object({
  name: z.string().trim().min(1, "O nome é obrigatório.").max(80),
  colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  imageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  outcome: wheelSegmentOutcomeSchema,
  prizeId: z.string().trim().max(60).optional().or(z.literal("")),
  weight: z.coerce.number().int().min(1).max(10000),
  totalQuantity: z.coerce.number().int().min(0).optional(),
  periodStart: z.string().trim().optional().or(z.literal("")),
  periodEnd: z.string().trim().optional().or(z.literal("")),
  message: z.string().trim().max(300).optional().or(z.literal("")),
  code: z.string().trim().max(80).optional().or(z.literal("")),
  isActive: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export const prizeSchema = z.object({
  internalName: z.string().trim().min(1, "O nome interno é obrigatório.").max(150),
  publicName: z.string().trim().min(1, "O nome público é obrigatório.").max(150),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  imageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  totalQuantity: z.coerce.number().int().min(0).optional(),
  dailyLimit: z.coerce.number().int().min(0).optional(),
  instructions: z.string().trim().max(1000).optional().or(z.literal("")),
  terms: z.string().trim().max(2000).optional().or(z.literal("")),
  isActive: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  startAt: z.string().trim().optional().or(z.literal("")),
  endAt: z.string().trim().optional().or(z.literal("")),
});

export const prizeCodeSchema = z.object({
  code: z.string().trim().min(1, "O código é obrigatório.").max(60),
  expiresAt: z.string().trim().optional().or(z.literal("")),
});
