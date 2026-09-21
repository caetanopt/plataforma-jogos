"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { createFolderSchema, renameFolderSchema } from "@/lib/validation/workspace";
import { foldersUrl } from "@/features/folders/view-params";

async function findOwnedWorkspace(organizationId: string, workspaceId: string) {
  return prisma.workspace.findFirst({ where: { id: workspaceId, organizationId } });
}

/**
 * Reconstrói o URL da grelha a partir dos parâmetros de vista submetidos.
 *
 * O `tab`/`sort` do formulário passa pela lista branca de `foldersUrl`, por
 * isso um valor forjado degrada para o URL por omissão em vez de virar um
 * destino de redirect arbitrário.
 */
function returnUrl(formData: FormData, error?: string): string {
  return foldersUrl({
    tab: formData.get("tab"),
    sort: formData.get("sort"),
    error,
  });
}

export async function createFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const parsed = createFolderSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    redirect(returnUrl(formData, "validation"));
  }

  const workspace = await findOwnedWorkspace(context.organizationId, parsed.data.workspaceId);
  if (!workspace) redirect(returnUrl(formData, "not_found"));

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
  redirect(returnUrl(formData));
}

export async function renameFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const parsed = renameFolderSchema.safeParse({
    folderId: formData.get("folderId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    redirect(returnUrl(formData, "validation"));
  }

  const folder = await prisma.folder.findFirst({
    where: { id: parsed.data.folderId, workspace: { organizationId: context.organizationId } },
  });
  if (!folder) redirect(returnUrl(formData, "not_found"));

  await prisma.folder.update({ where: { id: parsed.data.folderId }, data: { name: parsed.data.name } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Folder",
    entityId: parsed.data.folderId,
    result: "SUCCESS",
  });

  revalidatePath("/folders");
  redirect(returnUrl(formData));
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
  if (!folder) redirect(returnUrl(formData, "not_found"));

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
  redirect(returnUrl(formData));
}

export async function deleteFolderAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "workspace:manage");

  const folderId = String(formData.get("folderId") ?? "");
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, workspace: { organizationId: context.organizationId } },
    include: { _count: { select: { campaigns: true } } },
  });
  if (!folder) redirect(returnUrl(formData, "not_found"));

  if (folder._count.campaigns > 0) {
    redirect(returnUrl(formData, "folder_not_empty"));
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
  redirect(returnUrl(formData));
}
