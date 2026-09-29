import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateScheduleAction } from "@/features/campaigns/steps/schedule-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { utcToZonedDateTimeLocal } from "@/lib/dates/timezone";
import { SCHEDULE_LIMITS } from "@/lib/validation/campaign";
import { can } from "@/server/permissions";
import { isLiveStatus } from "@/features/campaigns/live-status";

// Os mesmos anos que o servidor aceita (dateTimeLocalField).
const DATE_MIN = "2000-01-01T00:00";
const DATE_MAX = "2100-12-31T23:59";

export default async function ScheduleStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  // Numa campanha no ar, mudar as datas abre ou fecha a campanha: só quem pode
  // publicar (ver updateScheduleAction, que aplica a mesma regra). Os campos
  // desativados não vão no envio, e o servidor mantém as datas gravadas.
  const datesLocked = isLiveStatus(campaign.status) && !can(context, "campaign:publish");

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-caetano-anthracite">Agenda</h2>
        <p className="mt-1 text-sm text-caetano-anthracite-80">
          Datas de início e fim da campanha (fuso horário: {campaign.timezone}).
        </p>
      </div>

      <Alert variant="info">
        A publicação e a expiração automáticas com base nestas datas acontecem na etapa
        &quot;Publicação&quot;, onde a campanha é efetivamente colocada em estado publicado.
      </Alert>

      <AutoSaveForm
        action={updateScheduleAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        {datesLocked && (
          <p id="schedule-dates-locked" className="text-sm text-caetano-anthracite-80">
            A campanha já foi publicada: mudar as datas abre-a ou fecha-a, por isso só quem tem
            permissão para publicar o pode fazer. As mensagens continuam editáveis.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="scheduleStartAt">Início</Label>
            <Input
              id="scheduleStartAt"
              name="scheduleStartAt"
              type="datetime-local"
              min={DATE_MIN}
              max={DATE_MAX}
              disabled={datesLocked}
              aria-describedby={datesLocked ? "schedule-dates-locked" : undefined}
              defaultValue={campaign.scheduleStartAt ? utcToZonedDateTimeLocal(campaign.scheduleStartAt, campaign.timezone) : ""}
            />
          </div>
          <div>
            <Label htmlFor="scheduleEndAt">Fim</Label>
            <Input
              id="scheduleEndAt"
              name="scheduleEndAt"
              type="datetime-local"
              min={DATE_MIN}
              max={DATE_MAX}
              disabled={datesLocked}
              aria-describedby={datesLocked ? "schedule-dates-locked" : undefined}
              defaultValue={campaign.scheduleEndAt ? utcToZonedDateTimeLocal(campaign.scheduleEndAt, campaign.timezone) : ""}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="scheduleBeforeMessage">Mensagem antes do início</Label>
          <textarea
            id="scheduleBeforeMessage"
            name="scheduleBeforeMessage"
            maxLength={SCHEDULE_LIMITS.message}
            defaultValue={campaign.scheduleBeforeMessage ?? ""}
            rows={2}
            placeholder="Esta campanha ainda não começou. Volte em breve!"
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label htmlFor="scheduleAfterMessage">Mensagem depois do fim</Label>
          <textarea
            id="scheduleAfterMessage"
            name="scheduleAfterMessage"
            maxLength={SCHEDULE_LIMITS.message}
            defaultValue={campaign.scheduleAfterMessage ?? ""}
            rows={2}
            placeholder="Esta campanha já terminou. Obrigado pelo interesse!"
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label htmlFor="scheduleRedirectUrl">Redirecionamento após o fim (opcional)</Label>
          <Input
            id="scheduleRedirectUrl"
            name="scheduleRedirectUrl"
            type="url"
            inputMode="url"
            maxLength={SCHEDULE_LIMITS.redirectUrl}
            placeholder="https://…"
            aria-describedby="scheduleRedirectUrl-help"
            defaultValue={campaign.scheduleRedirectUrl ?? ""}
          />
          <p id="scheduleRedirectUrl-help" className="mt-1 text-xs text-caetano-anthracite-80">
            Endereço completo, a começar por https://.
          </p>
        </div>
      </AutoSaveForm>
    </div>
  );
}
