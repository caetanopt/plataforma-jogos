"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { finalScreenShape } from "@/lib/validation/campaign";
import { emptyToNull, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { fail, partialResult, type ActionResult } from "@/lib/forms/action-result";

export async function updateFinalScreenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateFinalScreen", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!campaign) notFound();

    // Campo a campo: um link inválido já não deita fora o título e a mensagem.
    const { data, fieldErrors } = parsePartial(finalScreenShape, {
      finalTitle: readOptional(formData, "finalTitle"),
      finalMessage: readOptional(formData, "finalMessage"),
      finalMediaId: readOptional(formData, "finalMediaId"),
      finalCtaLabel: readOptional(formData, "finalCtaLabel"),
      finalCtaUrl: readOptional(formData, "finalCtaUrl"),
      finalAllowReplay: readCheckbox(formData, "finalAllowReplay"),
      finalAllowShare: readCheckbox(formData, "finalAllowShare"),
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.finalMediaId]))) {
      return fail("A imagem escolhida não está disponível. Carregue-a de novo.");
    }

    const update = {
      finalTitle: emptyToNull(data.finalTitle),
      finalMessage: emptyToNull(data.finalMessage),
      finalMediaId: emptyToNull(data.finalMediaId),
      finalCtaLabel: emptyToNull(data.finalCtaLabel),
      finalCtaUrl: emptyToNull(data.finalCtaUrl),
      finalAllowReplay: data.finalAllowReplay,
      finalAllowShare: data.finalAllowShare,
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: update });

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "SUCCESS",
        metadata: { step: "ecra-final" },
      });

      revalidatePath(`/apps/${campaign.id}/ecra-final`);
    }

    return partialResult(fieldErrors, savedSomething);
  });
}
