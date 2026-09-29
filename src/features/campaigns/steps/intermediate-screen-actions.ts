"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { intermediateScreenShape, screenKindSchema } from "@/lib/validation/campaign";
import { emptyToNull, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial } from "@/lib/forms/parse-partial";
import { fail, partialResult, type ActionResult } from "@/lib/forms/action-result";

export async function updateIntermediateScreenAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateIntermediateScreen", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!campaign) notFound();

    const kind = screenKindSchema.safeParse(readOptional(formData, "kind"));
    if (!kind.success) return fail("Ecrã desconhecido. Recarregue a página.");

    // Campo a campo: um link inválido já não deita fora o título e o texto.
    const { data, fieldErrors } = parsePartial(intermediateScreenShape, {
      enabled: readCheckbox(formData, "enabled"),
      title: readOptional(formData, "title"),
      text: readOptional(formData, "text"),
      mediaId: readOptional(formData, "mediaId"),
      ctaLabel: readOptional(formData, "ctaLabel"),
      ctaUrl: readOptional(formData, "ctaUrl"),
      continueButtonLabel: readOptional(formData, "continueButtonLabel"),
    });
    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.mediaId]))) {
      return fail("A imagem escolhida não está disponível. Carregue-a de novo.");
    }

    // Desligar só esconde o ecrã (antes apagava-o, e com ele o título, o
    // texto, a media e o CTA): o conteúdo enviado grava-se sempre.
    const update = {
      enabled: data.enabled,
      title: emptyToNull(data.title),
      text: emptyToNull(data.text),
      mediaId: emptyToNull(data.mediaId),
      ctaLabel: emptyToNull(data.ctaLabel),
      ctaUrl: emptyToNull(data.ctaUrl),
      continueButtonLabel: emptyToNull(data.continueButtonLabel),
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.campaignScreen.upsert({
        where: { campaignId_kind: { campaignId: campaign.id, kind: kind.data } },
        // Um ecrã que ainda não existe aparece desligado no editor: escrever
        // o título antes de o ativar não o pode pôr à vista dos participantes.
        create: { campaignId: campaign.id, kind: kind.data, ...update, enabled: data.enabled ?? false },
        update,
      });

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "SUCCESS",
        metadata: { step: "ecra-intermedio", kind: kind.data, enabled: data.enabled },
      });

      revalidatePath(`/apps/${campaign.id}/ecra-intermedio`);
    }

    return partialResult(fieldErrors, savedSomething);
  });
}
