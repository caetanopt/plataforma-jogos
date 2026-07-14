"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { createWorkspaceSchema } from "@/lib/validation/workspace";
import { slugify } from "@/lib/random/slug";

async function ensureUniqueWorkspaceSlug(organizationId: string, base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt}`;
    const existing = await prisma.workspace.findFirst({ where: { organizationId, slug } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    redirect("/workspaces?error=validation");
  }

  const slug = await ensureUniqueWorkspaceSlug(
    context.organizationId,
    slugify(parsed.data.name) || "espaco",
  );

  const workspace = await prisma.workspace.create({
    data: {
      organizationId: context.organizationId,
      name: parsed.data.name,
      slug,
      description: parsed.data.description || null,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "Workspace",
    entityId: workspace.id,
    result: "SUCCESS",
  });

  revalidatePath("/workspaces");
}

export async function renameWorkspaceAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const workspaceId = String(formData.get("workspaceId") ?? "");
  const parsed = createWorkspaceSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
  });
  if (!parsed.success) {
    redirect("/workspaces?error=validation");
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, organizationId: context.organizationId },
  });
  if (!workspace) redirect("/workspaces?error=not_found");

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { name: parsed.data.name, description: parsed.data.description || null },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Workspace",
    entityId: workspaceId,
    result: "SUCCESS",
  });

  revalidatePath("/workspaces");
}
