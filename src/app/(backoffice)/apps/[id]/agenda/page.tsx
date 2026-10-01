import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateScheduleAction } from "@/features/campaigns/steps/schedule-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import {
  FieldGroup,
  HELP_CLASS,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { utcToZonedDateTimeLocal } from "@/lib/dates/timezone";
import { cn } from "@/lib/utils";
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
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Agenda"
        description={<>Datas de início e fim da campanha (fuso horário: {campaign.timezone}).</>}
      />

      <Alert variant="info">
        A publicação e a expiração automáticas com base nestas datas acontecem na etapa
        &quot;Publicação&quot;, onde a campanha é efetivamente colocada em estado publicado.
      </Alert>

      <AutoSaveForm action={updateScheduleAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <FieldGroup title="Datas">
          {datesLocked && (
            <p
              id="schedule-dates-locked"
              className="rounded-lg bg-caetano-medium-gray-20 px-3 py-2 text-sm text-caetano-anthracite-80"
            >
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
        </FieldGroup>

        <FieldGroup title="Mensagens">
          <div>
            <Label htmlFor="scheduleBeforeMessage">Mensagem antes do início</Label>
            <textarea
              id="scheduleBeforeMessage"
              name="scheduleBeforeMessage"
              maxLength={SCHEDULE_LIMITS.message}
              defaultValue={campaign.scheduleBeforeMessage ?? ""}
              rows={2}
              placeholder="Esta campanha ainda não começou. Volte em breve!"
              className={TEXTAREA_CLASS}
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
              className={TEXTAREA_CLASS}
            />
          </div>
        </FieldGroup>

        <FieldGroup title="Depois do fim">
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
            <p id="scheduleRedirectUrl-help" className={HELP_CLASS}>
              Endereço completo, a começar por https://.
            </p>
          </div>
        </FieldGroup>
      </AutoSaveForm>
    </div>
  );
}
