import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateParticipationRulesAction } from "@/features/campaigns/steps/participation-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PARTICIPATION_LIMIT_TYPE_LABELS } from "@/lib/labels";

export default async function ParticipationRulesStepPage({
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
        <h2 className="text-lg font-semibold text-caetano-anthracite">Regras de participação</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Defina quantas vezes cada pessoa pode participar e requisitos de idade.
        </p>
      </div>

      <Alert variant="info">
        O controlo de duplicados por e-mail, telefone, cookie, sessão ou código é definido na
        etapa &quot;Formulário de leads&quot;. Estas regras são validadas sempre no servidor antes
        de iniciar o jogo.
      </Alert>

      <AutoSaveForm
        action={updateParticipationRulesAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div>
          <Label htmlFor="participationLimitType">Limite de participação</Label>
          <select
            key={`participationLimitType-${campaign.updatedAt.toISOString()}`}
            id="participationLimitType"
            name="participationLimitType"
            defaultValue={campaign.participationLimitType}
            className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            {Object.entries(PARTICIPATION_LIMIT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="participationCustomMax">Máximo personalizado</Label>
          <Input
            id="participationCustomMax"
            name="participationCustomMax"
            type="number"
            min={1}
            defaultValue={campaign.participationCustomMax ?? ""}
            disabled={campaign.participationLimitType !== "CUSTOM_MAX"}
            aria-describedby="participationCustomMax-help"
          />
          <p id="participationCustomMax-help" className="mt-1 text-xs text-caetano-medium-gray">
            Só aplicável quando o limite acima é &quot;Máximo personalizado&quot;.
          </p>
        </div>

        <div>
          <Label htmlFor="minAge">Idade mínima (opcional)</Label>
          <Input id="minAge" name="minAge" type="number" min={0} max={120} defaultValue={campaign.minAge ?? ""} />
        </div>

        <SaveStatus />
      </AutoSaveForm>
    </div>
  );
}
