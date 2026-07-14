import { z } from "zod";

export const campaignTypeSchema = z.enum(["MEMORY", "WHEEL", "QUIZ"]);

export const createCampaignSchema = z.object({
  type: campaignTypeSchema,
  workspaceId: z.string().min(1),
  folderId: z.string().min(1).optional(),
});

export const projectInfoSchema = z.object({
  internalName: z.string().trim().min(1, "O nome interno é obrigatório.").max(150),
  publicTitle: z.string().trim().max(150).optional().or(z.literal("")),
  internalReference: z.string().trim().max(100).optional().or(z.literal("")),
  workspaceId: z.string().min(1),
  folderId: z.string().min(1).optional().or(z.literal("")),
  tags: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  locale: z.string().trim().min(2).max(10).default("pt-PT"),
  timezone: z.string().trim().min(1).max(60).default("Europe/Lisbon"),
});

export const startScreenSchema = z.object({
  startTitle: z.string().trim().max(200).optional().or(z.literal("")),
  startSubtitle: z.string().trim().max(200).optional().or(z.literal("")),
  startIntroText: z.string().trim().max(2000).optional().or(z.literal("")),
  startMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  startLogoMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  startButtonLabel: z.string().trim().max(60).optional().or(z.literal("")),
  startPrizeInfo: z.string().trim().max(500).optional().or(z.literal("")),
  countdownEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  regulationText: z.string().trim().max(5000).optional().or(z.literal("")),
  legalText: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const brandThemeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  logoMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  faviconMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  backgroundImageMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  secondaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  buttonColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  buttonTextColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.string().trim().min(1).max(60),
  borderRadiusPx: z.coerce.number().int().min(0).max(48),
  shadowEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ProjectInfoInput = z.infer<typeof projectInfoSchema>;
export type StartScreenInput = z.infer<typeof startScreenSchema>;
export type BrandThemeInput = z.infer<typeof brandThemeSchema>;
