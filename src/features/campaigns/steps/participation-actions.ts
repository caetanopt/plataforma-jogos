"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { PARTICIPATION_CUSTOM_MAX_REQUIRED_MESSAGE, participationRulesShape } from "@/lib/validation/campaign";
import { readOptional } from "@/lib/forms/form-data";
import { editBreaksLiveAgeCheck, LIVE_MIN_AGE_NEEDS_BIRTH_DATE_MESSAGE } from "@/features/publishing/age-check";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { partialResult, type ActionResult } from "@/lib/forms/action-result";

export async function updateParticipationRulesAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateParticipationRules", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: {
        id: true,
        status: true,
        participationLimitType: true,
        participationCustomMax: true,
        minAge: true,
        leadForm: {
          select: { position: true, fields: { select: { type: true } }, consentDefinitions: { select: { id: true } } },
        },
      },
    });
    if (!campaign) notFound();

    // O máximo vai desativado (e não chega) quando o limite não é
    // personalizado: fica `undefined`.
    const parse = parsePartial(participationRulesShape, {
      participationLimitType: readOptional(formData, "participationLimitType"),
      participationCustomMax: readOptional(formData, "participationCustomMax"),
      minAge: readOptional(formData, "minAge"),
    });
    const { data } = parse;

    // "Máximo personalizado" sem máximo: antes gravava-se o tipo com o máximo
    // a null, e a campanha ficava limitada a uma participação sem ninguém
    // saber. Agora o tipo não muda nesse envio e o campo diz o que falta.
    let type = data.participationLimitType ?? campaign.participationLimitType;
    const customMax = data.participationCustomMax !== undefined ? data.participationCustomMax : campaign.participationCustomMax;
    if (type === "CUSTOM_MAX" && customMax == null) {
      // Um máximo inválido já traz a sua mensagem (ex.: "mínimo 1").
      if (!("participationCustomMax" in parse.fieldErrors)) {
        rejectField(parse, "participationCustomMax", PARTICIPATION_CUSTOM_MAX_REQUIRED_MESSAGE);
      }
      if (data.participationLimitType === "CUSTOM_MAX" && campaign.participationLimitType !== "CUSTOM_MAX") {
        delete data.participationLimitType;
        type = campaign.participationLimitType;
      }
    }

    // Numa campanha publicada, uma idade mínima sem data de nascimento no
    // formulário fechava-a a todos os visitantes.
    const ageForm = campaign.leadForm
      ? {
          position: campaign.leadForm.position,
          fields: campaign.leadForm.fields,
          consentCount: campaign.leadForm.consentDefinitions.length,
        }
      : null;
    if (
      data.minAge !== undefined &&
      editBreaksLiveAgeCheck(
        campaign.status,
        { minAge: campaign.minAge, form: ageForm },
        { minAge: data.minAge, form: ageForm },
      )
    ) {
      rejectField(parse, "minAge", LIVE_MIN_AGE_NEEDS_BIRTH_DATE_MESSAGE);
    }

    const update = {
      participationLimitType: data.participationLimitType,
      // Fora do "Máximo personalizado" o máximo não se aplica e fica a null.
      participationCustomMax:
        type === "CUSTOM_MAX"
          ? (data.participationCustomMax ?? undefined)
          : campaign.participationCustomMax !== null
            ? null
            : undefined,
      minAge: data.minAge,
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: update });

      // Regras de elegibilidade têm impacto direto no controlo de fraude
      // (secção 16) — auditar com antes/depois, como as alterações a
      // probabilidades/stock da Roda.
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "SUCCESS",
        metadata: {
          step: "regras",
          participationLimitTypeBefore: campaign.participationLimitType,
          participationLimitTypeAfter: update.participationLimitType ?? campaign.participationLimitType,
          participationCustomMaxBefore: campaign.participationCustomMax,
          participationCustomMaxAfter:
            update.participationCustomMax !== undefined ? update.participationCustomMax : campaign.participationCustomMax,
          minAgeBefore: campaign.minAge,
          minAgeAfter: update.minAge !== undefined ? update.minAge : campaign.minAge,
        },
      });

      revalidatePath(`/apps/${campaign.id}/regras`);
    }

    return partialResult(parse.fieldErrors, savedSomething);
  });
}
