"use server";

import { revalidatePath } from "next/cache";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getPublishReadiness, hasPrivacyNotice } from "@/features/publishing/readiness";
import { isAgeVerifiable } from "@/features/publishing/age-check";
import { loadPrivacyNoticeState } from "@/features/publishing/privacy-guard";
import { generateAndStoreQrCodes } from "@/features/publishing/qr";

function publicPlayUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/play/${slug}`;
}

export async function publishCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await getCampaignForEditor(context.organizationId, campaignId);
  if (!campaign) notFound();

  const readiness = getPublishReadiness(campaign);
  if (!readiness.ready) {
    redirect(`/apps/${campaignId}/publicar?error=readiness`);
  }

  const now = new Date();
  const nextStatus = campaign.scheduleStartAt && campaign.scheduleStartAt > now ? "SCHEDULED" : "PUBLISHED";

  const lastVersion = await prisma.campaignVersion.findFirst({
    where: { campaignId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (lastVersion?.versionNumber ?? 0) + 1;

  const snapshot = JSON.parse(JSON.stringify(campaign));

  // O upload do QR code (I/O externo, para o storage S3) corre primeiro e
  // fora de qualquer transação — se falhar, nada na BD foi tocado ainda,
  // por isso repetir a publicação fica sempre seguro. As três escritas na
  // BD (versão, publicação e o próprio estado da campanha) só acontecem
  // depois, atomicamente: sem isto, uma falha a meio (ex.: no update do
  // estado) deixava uma CampaignVersion/Publication "fantasma" sem a
  // campanha refletir a publicação, e uma nova tentativa criava outra
  // versão duplicada.
  const url = publicPlayUrl(campaign.slug);
  const { pngMediaId, svgMediaId } = await generateAndStoreQrCodes(context.organizationId, context.userId, url);

  const published = await prisma.$transaction(async (tx) => {
    // A verificação acima leu antes do upload do QR code: um autosave
    // entretanto (a campanha ainda é rascunho, a guarda do editor não se
    // aplica) podia tirar o único aviso de privacidade ou a data de
    // nascimento. Com a campanha bloqueada, as edições do aviso esperam, e
    // o que decide a publicação volta a ler-se aqui.
    await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR NO KEY UPDATE`;
    const { state } = await loadPrivacyNoticeState(campaignId, tx);
    const { minAge } = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { minAge: true } });
    const ageForm = state.leadForm
      ? { position: state.leadForm.position, fields: state.leadForm.fields, consentCount: state.leadForm.consentDefinitions.length }
      : null;
    if (!hasPrivacyNotice(state) || !isAgeVerifiable(minAge, ageForm as Parameters<typeof isAgeVerifiable>[1])) return false;

    const version = await tx.campaignVersion.create({
      data: {
        campaignId,
        versionNumber,
        snapshot,
        publishedById: context.userId,
      },
    });

    await tx.publication.create({
      data: {
        campaignVersionId: version.id,
        publishedById: context.userId,
        qrPngMediaId: pngMediaId,
        qrSvgMediaId: svgMediaId,
      },
    });

    await tx.campaign.update({
      where: { id: campaignId },
      data: { status: nextStatus, publishedAt: now },
    });
    return true;
  });
  if (!published) redirect(`/apps/${campaignId}/publicar?error=readiness`);

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PUBLISH",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { versionNumber, status: nextStatus },
  });

  revalidatePath(`/apps/${campaignId}/publicar`);
  revalidatePath("/apps");
}

export async function unpublishCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");

  const campaignId = String(formData.get("campaignId") ?? "");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) notFound();

  await prisma.campaign.update({ where: { id: campaignId }, data: { status: "DRAFT" } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { action: "unpublish" },
  });

  revalidatePath(`/apps/${campaignId}/publicar`);
  revalidatePath("/apps");
}
