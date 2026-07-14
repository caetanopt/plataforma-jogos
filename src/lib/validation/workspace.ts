import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, "O nome é obrigatório.").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const createFolderSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1, "O nome é obrigatório.").max(120),
});
