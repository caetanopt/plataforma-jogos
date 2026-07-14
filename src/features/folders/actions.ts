"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { createFolderSchema } from "@/lib/validation/workspace";

async function findOwnedWorkspace(organizationId: string, workspaceId: string) {
  return prisma.workspace.findFirst({ where: { id: workspaceId, organizationId } });
}

export async function createFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const parsed = createFolderSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    redirect("/folders?error=validation");
  }

  const workspace = await findOwnedWorkspace(context.organizationId, parsed.data.workspaceId);
  if (!workspace) redirect("/folders?error=not_found");

  const folder = await prisma.folder.create({
    data: { workspaceId: parsed.data.workspaceId, name: parsed.data.name },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "Folder",
    entityId: folder.id,
    result: "SUCCESS",
  });

  revalidatePath("/folders");
}

export async function renameFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const folderId = String(formData.get("folderId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/folders?error=validation");

  const folder = await prisma.folder.findFirst({
    where: { id: folderId, workspace: { organizationId: context.organizationId } },
  });
  if (!folder) redirect("/folders?error=not_found");

  await prisma.folder.update({ where: { id: folderId }, data: { name } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Folder",
    entityId: folderId,
    result: "SUCCESS",
  });

  revalidatePath("/folders");
}

export async function archiveFolderAction(formData: FormData): Promise<void> {
  await setFolderArchived(formData, true);
}

export async function unarchiveFolderAction(formData: FormData): Promise<void> {
  await setFolderArchived(formData, false);
}

async function setFolderArchived(formData: FormData, archived: boolean): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const folderId = String(formData.get("folderId") ?? "");
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, workspace: { organizationId: context.organizationId } },
  });
  if (!folder) redirect("/folders?error=not_found");

  await prisma.folder.update({
    where: { id: folderId },
    data: { archivedAt: archived ? new Date() : null },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: archived ? "ARCHIVE" : "UPDATE",
    entityType: "Folder",
    entityId: folderId,
    result: "SUCCESS",
  });

  revalidatePath("/folders");
}

export async function deleteFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const folderId = String(formData.get("folderId") ?? "");
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, workspace: { organizationId: context.organizationId } },
    include: { _count: { select: { campaigns: true } } },
  });
  if (!folder) redirect("/folders?error=not_found");

  if (folder._count.campaigns > 0) {
    redirect("/folders?error=folder_not_empty");
  }

  await prisma.folder.delete({ where: { id: folderId } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "DELETE",
    entityType: "Folder",
    entityId: folderId,
    result: "SUCCESS",
  });

  revalidatePath("/folders");
}
