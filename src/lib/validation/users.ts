import { z } from "zod";

export const membershipRoleSchema = z.enum(["ORG_ADMIN", "EDITOR", "ANALYST", "VIEWER"]);

export const inviteUserSchema = z.object({
  name: z.string().trim().min(1, "O nome é obrigatório.").max(150),
  email: z.string().trim().toLowerCase().email(),
  role: membershipRoleSchema,
  canPublish: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  canExportLeads: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export const updateMembershipSchema = z.object({
  role: membershipRoleSchema,
  canPublish: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  canExportLeads: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
