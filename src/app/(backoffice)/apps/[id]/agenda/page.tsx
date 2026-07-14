import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateScheduleAction } from "@/features/campaigns/steps/schedule-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

function toDatetimeLocalValue(date: Date | null): string {
  if (!date) return "";
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default async function ScheduleStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Agenda</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Datas de início e fim da campanha (fuso horário: {campaign.timezone}).
        </p>
      </div>

      <Alert variant="info">
        A publicação e a expiração automáticas com base nestas datas acontecem na etapa
        &quot;Publicação&quot;, onde a campanha é efetivamente colocada em estado publicado.
      </Alert>

      <AutoSaveForm
        action={updateScheduleAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="scheduleStartAt">Início</Label>
            <Input
              id="scheduleStartAt"
              name="scheduleStartAt"
              type="datetime-local"
              defaultValue={toDatetimeLocalValue(campaign.scheduleStartAt)}
            />
          </div>
          <div>
            <Label htmlFor="scheduleEndAt">Fim</Label>
            <Input
              id="scheduleEndAt"
              name="scheduleEndAt"
              type="datetime-local"
              defaultValue={toDatetimeLocalValue(campaign.scheduleEndAt)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="scheduleBeforeMessage">Mensagem antes do início</Label>
          <textarea
            id="scheduleBeforeMessage"
            name="scheduleBeforeMessage"
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
            placeholder="https://…"
            defaultValue={campaign.scheduleRedirectUrl ?? ""}
          />
        </div>

        <SaveStatus />
      </AutoSaveForm>
    </div>
  );
}
