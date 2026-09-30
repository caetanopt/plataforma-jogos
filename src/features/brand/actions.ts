"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { createBrandKitSchema, organizationLogoShape, parseThemeForm } from "@/lib/validation/brand";
import { mergeLegalLinks } from "@/features/brand/legal-links";
import { emptyToNull, getField, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { fail, ok, partialResult, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";

export async function createBrandKitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("createBrandKit", async () => {
    const context = await requireOrgContext();
    assertCan(context, "brand:manage");

    const parsed = createBrandKitSchema.safeParse({ name: getField(formData, "name") });
    if (!parsed.success) {
      return fail("O brand kit não foi criado.", zodFieldErrors(parsed.error));
    }

    const kit = await prisma.campaignTheme.create({
      data: { organizationId: context.organizationId, name: parsed.data.name, isBrandKit: true },
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

    revalidatePath("/brand");
    return ok("Brand kit criado.");
  });
}

export async function updateBrandKitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateBrandKit", async () => {
    const context = await requireOrgContext();
    assertCan(context, "brand:manage");

    const kitId = readOptional(formData, "kitId") ?? "";
    const kit = await prisma.campaignTheme.findFirst({
      where: { id: kitId, organizationId: context.organizationId, isBrandKit: true },
      select: { id: true, legalLinks: true },
    });
    if (!kit) notFound();

    // Campo a campo: apagar o nome para escrever outro já não deita fora as
    // cores; o nome continua obrigatório e volta com o erro.
    const { update, legalLinkChanges, fieldErrors, mediaIds, savedSomething } = parseThemeForm(formData, {
      includeName: true,
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, mediaIds))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    if (savedSomething) {
      await prisma.campaignTheme.update({
        where: { id: kit.id },
        data: {
          ...update,
          ...(Object.keys(legalLinkChanges).length > 0
            ? { legalLinks: mergeLegalLinks(kit.legalLinks, legalLinkChanges) }
            : {}),
        },
      });

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "CampaignTheme",
        entityId: kit.id,
        result: "SUCCESS",
      });

      revalidatePath("/brand");
    }

    return partialResult(fieldErrors, savedSomething);
  });
}

export async function deleteBrandKitAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("deleteBrandKit", async () => {
    const context = await requireOrgContext();
    assertCan(context, "brand:manage");

    const kitId = getField(formData, "kitId");
    const kit = await prisma.campaignTheme.findFirst({
      where: { id: kitId, organizationId: context.organizationId, isBrandKit: true },
      select: { id: true },
    });
    if (!kit) notFound();

    await prisma.campaignTheme.delete({ where: { id: kit.id } });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "CampaignTheme",
      entityId: kit.id,
      result: "SUCCESS",
    });

    revalidatePath("/brand");
    return ok();
  });
}

/**
 * Guarda o ficheiro oficial do logótipo da organização, mostrado no
 * backoffice. O wordmark é um desenho autoral sem fonte associada (Brand
 * Book 03) — só pode ser apresentado a partir do ficheiro oficial, nunca
 * composto tipograficamente.
 *
 * Grava quando o upload termina (ou no "Remover"): o formulário só tem este
 * campo.
 */
export async function updateOrganizationLogoAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateOrganizationLogo", async () => {
    const context = await requireOrgContext();
    assertCan(context, "brand:manage");

    const { data, fieldErrors } = parsePartial(organizationLogoShape, {
      logoMediaId: readOptional(formData, "logoMediaId"),
    });
    const logoMediaId = emptyToNull(data.logoMediaId);
    if (logoMediaId === undefined) return partialResult(fieldErrors, false);

    // Só aceita media da própria organização (isolamento multi-tenant).
    if (!(await mediaBelongsToOrganization(context.organizationId, [logoMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    await prisma.organization.update({
      where: { id: context.organizationId },
      data: { logoMediaId },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "Organization",
      entityId: context.organizationId,
      result: "SUCCESS",
      metadata: { field: "logoMediaId", cleared: logoMediaId === null },
    });

    revalidatePath("/", "layout");
    return partialResult(fieldErrors, true);
  });
}
