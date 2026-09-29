"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { startScreenShape } from "@/lib/validation/campaign";
import { emptyToNull, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { fail, partialResult, type ActionResult } from "@/lib/forms/action-result";

export async function updateStartScreenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateStartScreen", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!campaign) notFound();

    // Campo a campo: um regulamento acima do limite já não deita fora o
    // título e o resto do formulário.
    const { data, fieldErrors } = parsePartial(startScreenShape, {
      startTitle: readOptional(formData, "startTitle"),
      startSubtitle: readOptional(formData, "startSubtitle"),
      startIntroText: readOptional(formData, "startIntroText"),
      startMediaId: readOptional(formData, "startMediaId"),
      startLogoMediaId: readOptional(formData, "startLogoMediaId"),
      startButtonLabel: readOptional(formData, "startButtonLabel"),
      startPrizeInfo: readOptional(formData, "startPrizeInfo"),
      countdownEnabled: readCheckbox(formData, "countdownEnabled"),
      regulationText: readOptional(formData, "regulationText"),
      legalText: readOptional(formData, "legalText"),
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.startMediaId, data.startLogoMediaId]))) {
      return fail("A imagem escolhida não está disponível. Carregue-a de novo.");
    }

    const update = {
      startTitle: emptyToNull(data.startTitle),
      startSubtitle: emptyToNull(data.startSubtitle),
      startIntroText: emptyToNull(data.startIntroText),
      startMediaId: emptyToNull(data.startMediaId),
      startLogoMediaId: emptyToNull(data.startLogoMediaId),
      startButtonLabel: emptyToNull(data.startButtonLabel),
      startPrizeInfo: emptyToNull(data.startPrizeInfo),
      countdownEnabled: data.countdownEnabled,
      regulationText: emptyToNull(data.regulationText),
      legalText: emptyToNull(data.legalText),
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
        metadata: { step: "ecra-inicial" },
      });

      revalidatePath(`/apps/${campaign.id}/ecra-inicial`);
    }

    return partialResult(fieldErrors, savedSomething);
  });
}
