"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { parseThemeForm, saveAsBrandKitSchema } from "@/lib/validation/brand";
import { mergeLegalLinks } from "@/features/brand/legal-links";
import { editRemovesLivePrivacyNotice, LIVE_PRIVACY_NOTICE_MESSAGE } from "@/features/publishing/readiness";
import { loadPrivacyNoticeState } from "@/features/publishing/privacy-guard";
import { getField, readOptional } from "@/lib/forms/form-data";
import { fail, ok, partialResult, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";

async function getCampaignWithTheme(organizationId: string, campaignId: string) {
  return prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { theme: true },
  });
}

export async function updateCampaignThemeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateCampaignTheme", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
    if (!campaign || !campaign.theme) notFound();

    // Campo a campo: uma cor inválida já não deita fora o resto do tema. O
    // nome do tema da campanha não se edita nesta etapa.
    const { update, legalLinkChanges, fieldErrors, mediaIds, savedSomething } = parseThemeForm(formData, {
      includeName: false,
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, mediaIds))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    // Numa campanha publicada, tirar a política de privacidade não pode
    // deixar o formulário a pedir dados sem aviso.
    if (legalLinkChanges.privacyPolicyUrl !== undefined) {
      const { status, state } = await loadPrivacyNoticeState(campaign.id);
      const after = { ...state, theme: { legalLinks: mergeLegalLinks(campaign.theme.legalLinks, legalLinkChanges) } };
      if (editRemovesLivePrivacyNotice(status, state, after)) {
        delete legalLinkChanges.privacyPolicyUrl;
        fieldErrors.privacyPolicyUrl = LIVE_PRIVACY_NOTICE_MESSAGE;
      }
    }
    const saving = savedSomething && (Object.values(update).some((value) => value !== undefined) || Object.keys(legalLinkChanges).length > 0);

    if (saving) {
      await prisma.campaignTheme.update({
        where: { id: campaign.theme.id },
        data: {
          ...update,
          ...(Object.keys(legalLinkChanges).length > 0
            ? { legalLinks: mergeLegalLinks(campaign.theme.legalLinks, legalLinkChanges) }
            : {}),
        },
      });

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "CampaignTheme",
        entityId: campaign.theme.id,
        result: "SUCCESS",
      });

      revalidatePath(`/apps/${campaign.id}/marca`);
    }

    return partialResult(fieldErrors, saving);
  });
}

/**
 * Copia o tema gravado da campanha para um brand kit novo. Lê da base de
 * dados: uma alteração ao tema ainda à espera da gravação automática (menos
 * de um segundo) não entra no kit.
 */
export async function saveAsBrandKitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("saveAsBrandKit", async () => {
    const context = await requireOrgContext();
    assertCan(context, "brand:manage");

    const campaignId = getField(formData, "campaignId");
    const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
    if (!campaign || !campaign.theme) notFound();

    const parsed = saveAsBrandKitSchema.safeParse({ kitName: getField(formData, "kitName") });
    if (!parsed.success) {
      return fail("O brand kit não foi guardado.", zodFieldErrors(parsed.error));
    }

    const kit = await prisma.campaignTheme.create({
      data: {
        organizationId: context.organizationId,
        name: parsed.data.kitName,
        isBrandKit: true,
        logoMediaId: campaign.theme.logoMediaId,
        faviconMediaId: campaign.theme.faviconMediaId,
        backgroundImageMediaId: campaign.theme.backgroundImageMediaId,
        primaryColor: campaign.theme.primaryColor,
        secondaryColor: campaign.theme.secondaryColor,
        backgroundColor: campaign.theme.backgroundColor,
        textColor: campaign.theme.textColor,
        buttonColor: campaign.theme.buttonColor,
        buttonTextColor: campaign.theme.buttonTextColor,
        fontFamily: campaign.theme.fontFamily,
        borderRadiusPx: campaign.theme.borderRadiusPx,
        shadowEnabled: campaign.theme.shadowEnabled,
        headerConfig: campaign.theme.headerConfig ?? undefined,
        footerConfig: campaign.theme.footerConfig ?? undefined,
        legalLinks: campaign.theme.legalLinks ?? undefined,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "CampaignTheme",
      entityId: kit.id,
      result: "SUCCESS",
      metadata: { brandKit: true },
    });

    revalidatePath(`/apps/${campaign.id}/marca`);
    revalidatePath("/brand");
    return ok("Brand kit guardado.");
  });
}

export async function applyBrandKitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("applyBrandKit", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const brandKitId = getField(formData, "brandKitId");

    const campaign = await getCampaignWithTheme(context.organizationId, campaignId);
    const brandKit = await prisma.campaignTheme.findFirst({
      where: { id: brandKitId, organizationId: context.organizationId, isBrandKit: true },
    });
    if (!campaign || !campaign.theme || !brandKit) notFound();

    // Um kit sem política de privacidade não a tira a uma campanha publicada
    // cujo formulário pede dados: os links legais da campanha ficam.
    const { status, state } = await loadPrivacyNoticeState(campaign.id);
    const keepLegalLinks =
      brandKit.legalLinks != null &&
      editRemovesLivePrivacyNotice(status, state, { ...state, theme: { legalLinks: brandKit.legalLinks } });

    await prisma.campaignTheme.update({
      where: { id: campaign.theme.id },
      data: {
        sourceBrandKitId: brandKit.id,
        logoMediaId: brandKit.logoMediaId,
        faviconMediaId: brandKit.faviconMediaId,
        backgroundImageMediaId: brandKit.backgroundImageMediaId,
        primaryColor: brandKit.primaryColor,
        secondaryColor: brandKit.secondaryColor,
        backgroundColor: brandKit.backgroundColor,
        textColor: brandKit.textColor,
        buttonColor: brandKit.buttonColor,
        buttonTextColor: brandKit.buttonTextColor,
        fontFamily: brandKit.fontFamily,
        borderRadiusPx: brandKit.borderRadiusPx,
        shadowEnabled: brandKit.shadowEnabled,
        headerConfig: brandKit.headerConfig ?? undefined,
        footerConfig: brandKit.footerConfig ?? undefined,
        legalLinks: keepLegalLinks ? undefined : (brandKit.legalLinks ?? undefined),
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "CampaignTheme",
      entityId: campaign.theme.id,
      result: "SUCCESS",
      metadata: { appliedBrandKitId: brandKit.id },
    });

    revalidatePath(`/apps/${campaign.id}/marca`);
    return ok(
      keepLegalLinks
        ? "Brand kit aplicado. Os links legais da campanha ficaram: o kit não tem política de privacidade e a campanha publicada precisa dela."
        : "Brand kit aplicado.",
    );
  });
}
