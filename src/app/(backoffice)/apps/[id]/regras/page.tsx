import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateParticipationRulesAction } from "@/features/campaigns/steps/participation-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ParticipationLimitFields } from "@/components/backoffice/editor/participation-limit-fields";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import {
  FieldGroup,
  HELP_CLASS,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
} from "@/components/backoffice/editor/editor-ui";
import { PARTICIPATION_LIMIT_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { PARTICIPATION_LIMITS } from "@/lib/validation/campaign";
import { isLiveStatus } from "@/features/campaigns/live-status";
import { isAgeVerifiable, LIVE_AGE_BLOCKED_WARNING } from "@/features/publishing/age-check";

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

  const ageBlocked =
    isLiveStatus(campaign.status) &&
    !isAgeVerifiable(
      campaign.minAge,
      campaign.leadForm
        ? {
            position: campaign.leadForm.position,
            fields: campaign.leadForm.fields,
            consentCount: campaign.leadForm.consentDefinitions.length,
          }
        : null,
    );

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Regras de participação"
        description="Defina quantas vezes cada pessoa pode participar e requisitos de idade."
      />

      <Alert variant="info">
        O controlo de duplicados por e-mail, telefone, cookie, sessão ou código é definido na
        etapa &quot;Formulário de leads&quot;. Estas regras são validadas sempre no servidor antes
        de iniciar o jogo.
      </Alert>

      {ageBlocked ? <Alert variant="warning" live={false}>{LIVE_AGE_BLOCKED_WARNING}</Alert> : null}

      <AutoSaveForm action={updateParticipationRulesAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <FieldGroup title="Limite por pessoa">
          <ParticipationLimitFields
            options={LIMIT_TYPE_OPTIONS}
            defaultType={campaign.participationLimitType}
            defaultCustomMax={campaign.participationCustomMax}
            customMaxMin={PARTICIPATION_LIMITS.customMaxMin}
            customMaxMax={PARTICIPATION_LIMITS.customMaxMax}
          />
        </FieldGroup>

        <FieldGroup title="Idade">
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
              className="sm:max-w-xs"
            />
            <p id="minAge-help" className={HELP_CLASS}>
              Vazio: sem idade mínima. Só se verifica com o campo «Data de nascimento» no formulário de leads.
            </p>
          </div>
        </FieldGroup>
      </AutoSaveForm>
    </div>
  );
}
