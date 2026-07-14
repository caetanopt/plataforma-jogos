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

export const screenKindSchema = z.enum(["INTERMEDIATE_BEFORE", "INTERMEDIATE_AFTER"]);

export const intermediateScreenSchema = z.object({
  kind: screenKindSchema,
  enabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  title: z.string().trim().max(200).optional().or(z.literal("")),
  text: z.string().trim().max(2000).optional().or(z.literal("")),
  mediaId: z.string().trim().max(60).optional().or(z.literal("")),
  ctaLabel: z.string().trim().max(60).optional().or(z.literal("")),
  ctaUrl: z.string().trim().max(500).optional().or(z.literal("")),
  continueButtonLabel: z.string().trim().max(60).optional().or(z.literal("")),
});

export const finalScreenSchema = z.object({
  finalTitle: z.string().trim().max(200).optional().or(z.literal("")),
  finalMessage: z.string().trim().max(2000).optional().or(z.literal("")),
  finalMediaId: z.string().trim().max(60).optional().or(z.literal("")),
  finalCtaLabel: z.string().trim().max(60).optional().or(z.literal("")),
  finalCtaUrl: z.string().trim().max(500).optional().or(z.literal("")),
  finalAllowReplay: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  finalAllowShare: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export const participationLimitTypeSchema = z.enum([
  "UNLIMITED",
  "ONE_TOTAL",
  "ONE_PER_DAY",
  "ONE_PER_HOUR",
  "CUSTOM_MAX",
]);

export const participationRulesSchema = z.object({
  participationLimitType: participationLimitTypeSchema,
  participationCustomMax: z.string().trim().optional().or(z.literal("")),
  minAge: z.string().trim().optional().or(z.literal("")),
});

export const scheduleSchema = z
  .object({
    scheduleStartAt: z.string().trim().optional().or(z.literal("")),
    scheduleEndAt: z.string().trim().optional().or(z.literal("")),
    scheduleBeforeMessage: z.string().trim().max(500).optional().or(z.literal("")),
    scheduleAfterMessage: z.string().trim().max(500).optional().or(z.literal("")),
    scheduleRedirectUrl: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine(
    (data) => {
      if (!data.scheduleStartAt || !data.scheduleEndAt) return true;
      return new Date(data.scheduleStartAt) < new Date(data.scheduleEndAt);
    },
    { message: "A data de início deve ser anterior à data de fim.", path: ["scheduleEndAt"] },
  );

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ProjectInfoInput = z.infer<typeof projectInfoSchema>;
export type StartScreenInput = z.infer<typeof startScreenSchema>;
export type BrandThemeInput = z.infer<typeof brandThemeSchema>;
export type IntermediateScreenInput = z.infer<typeof intermediateScreenSchema>;
export type FinalScreenInput = z.infer<typeof finalScreenSchema>;
export type ParticipationRulesInput = z.infer<typeof participationRulesSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
