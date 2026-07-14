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

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type ProjectInfoInput = z.infer<typeof projectInfoSchema>;
