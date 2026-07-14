"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { projectInfoSchema } from "@/lib/validation/campaign";
import { slugify } from "@/lib/random/slug";

export async function updateProjectInfoAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  const parsed = projectInfoSchema.safeParse({
    internalName: formData.get("internalName"),
    publicTitle: formData.get("publicTitle"),
    internalReference: formData.get("internalReference"),
    workspaceId: formData.get("workspaceId"),
    folderId: formData.get("folderId"),
    tags: formData.get("tags"),
    description: formData.get("description"),
    locale: formData.get("locale") || "pt-PT",
    timezone: formData.get("timezone") || "Europe/Lisbon",
  });
  if (!parsed.success) return;

  const workspace = await prisma.workspace.findFirst({
    where: { id: parsed.data.workspaceId, organizationId: context.organizationId },
  });
  if (!workspace) return;

  if (parsed.data.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: parsed.data.folderId, workspaceId: parsed.data.workspaceId },
    });
    if (!folder) return;
  }

  let slug = slugify(String(formData.get("slug") ?? "")) || campaign.slug;
  if (slug !== campaign.slug) {
    const existing = await prisma.campaign.findUnique({ where: { slug } });
    if (existing) slug = campaign.slug;
  }

  const tags = (parsed.data.tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      internalName: parsed.data.internalName,
      publicTitle: parsed.data.publicTitle || null,
      internalReference: parsed.data.internalReference || null,
      workspaceId: parsed.data.workspaceId,
      folderId: parsed.data.folderId || null,
      tags,
      description: parsed.data.description || null,
      locale: parsed.data.locale,
      timezone: parsed.data.timezone,
      slug,
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { step: "informacoes" },
  });

  revalidatePath(`/apps/${campaignId}/informacoes`);
  revalidatePath(`/apps/${campaignId}`);
}
