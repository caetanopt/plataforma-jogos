import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateParticipationRulesAction } from "@/features/campaigns/steps/participation-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ParticipationLimitFields } from "@/components/backoffice/editor/participation-limit-fields";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { PARTICIPATION_LIMIT_TYPE_LABELS } from "@/lib/labels";
import { PARTICIPATION_LIMITS } from "@/lib/validation/campaign";

const LIMIT_TYPE_OPTIONS = Object.entries(PARTICIPATION_LIMIT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export default async function ParticipationRulesStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-caetano-anthracite">Regras de participação</h2>
        <p className="mt-1 text-sm text-caetano-anthracite-80">
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
        className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        <ParticipationLimitFields
          options={LIMIT_TYPE_OPTIONS}
          defaultType={campaign.participationLimitType}
          defaultCustomMax={campaign.participationCustomMax}
          customMaxMin={PARTICIPATION_LIMITS.customMaxMin}
          customMaxMax={PARTICIPATION_LIMITS.customMaxMax}
        />

        <div>
          <Label htmlFor="minAge">Idade mínima (opcional)</Label>
          <Input
            id="minAge"
            name="minAge"
            type="number"
            inputMode="numeric"
            min={PARTICIPATION_LIMITS.minAgeMin}
            max={PARTICIPATION_LIMITS.minAgeMax}
            step={1}
            defaultValue={campaign.minAge ?? ""}
            aria-describedby="minAge-help"
          />
          <p id="minAge-help" className="mt-1 text-xs text-caetano-anthracite-80">
            Vazio: sem idade mínima.
          </p>
        </div>
      </AutoSaveForm>
    </div>
  );
}
