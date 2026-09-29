"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { SCHEDULE_ORDER_MESSAGE, scheduleShape } from "@/lib/validation/campaign";
import { emptyToNull, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { partialResult, type ActionResult } from "@/lib/forms/action-result";
import { utcToZonedDateTimeLocal, zonedDateTimeToUtc } from "@/lib/dates/timezone";
import { isLiveStatus } from "@/features/campaigns/live-status";

const DATE_FIELDS = [
  { key: "scheduleStartAt", label: "Início" },
  { key: "scheduleEndAt", label: "Fim" },
] as const;

export async function updateScheduleAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateSchedule", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: { id: true, status: true, timezone: true, scheduleStartAt: true, scheduleEndAt: true },
    });
    if (!campaign) notFound();

    // Mensagens e datas valem cada uma por si: um link inválido já não deita
    // fora as mensagens, nem uma data mal escrita o resto.
    const parse = parsePartial(scheduleShape, {
      scheduleStartAt: readOptional(formData, "scheduleStartAt"),
      scheduleEndAt: readOptional(formData, "scheduleEndAt"),
      scheduleBeforeMessage: readOptional(formData, "scheduleBeforeMessage"),
      scheduleAfterMessage: readOptional(formData, "scheduleAfterMessage"),
      scheduleRedirectUrl: readOptional(formData, "scheduleRedirectUrl"),
    });

    // Numa campanha que já está no ar, as datas decidem se ela aceita
    // participações (getEffectivePublicState lê-as em direto): empurrar o fim
    // reabre uma campanha expirada, puxar o início abre uma agendada. Isso é
    // publicar ou despublicar, e exige a mesma permissão.
    const mayChangeDates = !isLiveStatus(campaign.status) || can(context, "campaign:publish");

    // Por data: `undefined` mantém a gravada, `null` apaga.
    const dates: Record<(typeof DATE_FIELDS)[number]["key"], Date | null | undefined> = {
      scheduleStartAt: undefined,
      scheduleEndAt: undefined,
    };
    for (const { key, label } of DATE_FIELDS) {
      const value = parse.data[key];
      if (value === undefined) continue;
      if (!mayChangeDates) {
        // Sem permissão, a página desativa as datas e um input desativado não
        // vai no FormData (fica `undefined`, acima). Se vierem na mesma — uma
        // página aberta antes de a campanha ser publicada, ou um pedido
        // forjado —, a data gravada fica, e só se avisa quando é outra.
        const stored = campaign[key];
        const shown = stored ? utcToZonedDateTimeLocal(stored, campaign.timezone) : "";
        if (value.slice(0, 16) === shown) delete parse.data[key];
        else rejectField(parse, key, `${label}: numa campanha publicada, só quem pode publicar muda as datas.`);
        continue;
      }
      // A hora vem do <input type="datetime-local"> como hora "de parede",
      // sem fuso — interpreta-se no fuso da campanha, não no do processo do
      // servidor (que é o que new Date(str) usaria).
      const date = value === "" ? null : zonedDateTimeToUtc(value, campaign.timezone);
      if (value !== "" && !date) rejectField(parse, key, `${label}: data inválida.`);
      else dates[key] = date;
    }

    // Início antes do fim, com o que fica gravado de cada lado (o enviado ou
    // o atual). Recusam-se as duas: gravar só uma deixava a agenda ao
    // contrário.
    if (dates.scheduleStartAt !== undefined || dates.scheduleEndAt !== undefined) {
      const startAt = dates.scheduleStartAt !== undefined ? dates.scheduleStartAt : campaign.scheduleStartAt;
      const endAt = dates.scheduleEndAt !== undefined ? dates.scheduleEndAt : campaign.scheduleEndAt;
      if (startAt && endAt && startAt.getTime() >= endAt.getTime()) {
        dates.scheduleStartAt = undefined;
        dates.scheduleEndAt = undefined;
        delete parse.data.scheduleStartAt;
        rejectField(parse, "scheduleEndAt", SCHEDULE_ORDER_MESSAGE);
      }
    }

    const update = {
      scheduleStartAt: dates.scheduleStartAt,
      scheduleEndAt: dates.scheduleEndAt,
      scheduleBeforeMessage: emptyToNull(parse.data.scheduleBeforeMessage),
      scheduleAfterMessage: emptyToNull(parse.data.scheduleAfterMessage),
      scheduleRedirectUrl: emptyToNull(parse.data.scheduleRedirectUrl),
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.campaign.update({ where: { id: campaign.id }, data: update });

      const datesChanged = update.scheduleStartAt !== undefined || update.scheduleEndAt !== undefined;
      const startAfter = update.scheduleStartAt !== undefined ? update.scheduleStartAt : campaign.scheduleStartAt;
      const endAfter = update.scheduleEndAt !== undefined ? update.scheduleEndAt : campaign.scheduleEndAt;

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "SUCCESS",
        metadata: {
          field: "schedule",
          // Datas antes/depois: são elas que abrem e fecham a campanha (§26).
          ...(datesChanged && {
            startBefore: campaign.scheduleStartAt?.toISOString() ?? null,
            startAfter: startAfter?.toISOString() ?? null,
            endBefore: campaign.scheduleEndAt?.toISOString() ?? null,
            endAfter: endAfter?.toISOString() ?? null,
          }),
        },
      });

      revalidatePath(`/apps/${campaign.id}/agenda`);
    }

    return partialResult(parse.fieldErrors, savedSomething);
  });
}
