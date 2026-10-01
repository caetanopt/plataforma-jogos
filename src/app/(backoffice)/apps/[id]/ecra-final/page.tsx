import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateFinalScreenAction } from "@/features/campaigns/steps/final-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { CheckboxField } from "@/components/ui/checkbox-field";
import {
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_TILE_CLASS,
  FieldGroup,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { FINAL_SCREEN_LIMITS } from "@/lib/validation/campaign";
import { cn } from "@/lib/utils";

export default async function FinalScreenStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const finalMedia = campaign.finalMediaId
    ? await prisma.mediaAsset.findFirst({ where: { id: campaign.finalMediaId, organizationId: context.organizationId } })
    : null;

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Resultado e ecrã final"
        description="O último ecrã que os participantes veem, depois de jogar."
      />

      <Alert variant="info">
        O resultado, a pontuação, o tempo, o prémio e o código atribuído são sempre calculados e
        apresentados automaticamente pelo motor de cada jogo — aqui configura apenas o conteúdo
        fixo à volta desse resultado.
      </Alert>

      <AutoSaveForm action={updateFinalScreenAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <FieldGroup title="Conteúdo">
          <div>
            <Label htmlFor="finalTitle">Título</Label>
            <Input
              id="finalTitle"
              name="finalTitle"
              maxLength={FINAL_SCREEN_LIMITS.finalTitle}
              defaultValue={campaign.finalTitle ?? ""}
            />
          </div>

          <div>
            <Label htmlFor="finalMessage">Mensagem</Label>
            <textarea
              id="finalMessage"
              name="finalMessage"
              maxLength={FINAL_SCREEN_LIMITS.finalMessage}
              defaultValue={campaign.finalMessage ?? ""}
              rows={3}
              className={TEXTAREA_CLASS}
            />
          </div>

          <MediaUploadField
            name="finalMediaId"
            label="Imagem ou vídeo"
            defaultMediaId={campaign.finalMediaId}
            defaultUrl={finalMedia?.url}
            defaultKind={finalMedia?.kind}
            helpText="JPG, PNG, WebP, GIF ou MP4 — até 20 MB (100 MB para vídeo)."
          />
        </FieldGroup>

        <FieldGroup title="Botão de ação">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="finalCtaLabel">Texto do botão de ação (opcional)</Label>
              <Input
                id="finalCtaLabel"
                name="finalCtaLabel"
                maxLength={FINAL_SCREEN_LIMITS.finalCtaLabel}
                defaultValue={campaign.finalCtaLabel ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="finalCtaUrl">Link do botão de ação (opcional)</Label>
              <Input
                id="finalCtaUrl"
                name="finalCtaUrl"
                type="url"
                inputMode="url"
                maxLength={FINAL_SCREEN_LIMITS.finalCtaUrl}
                placeholder="https://"
                defaultValue={campaign.finalCtaUrl ?? ""}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Opções">
          <div className="grid gap-3 sm:grid-cols-2">
            <CheckboxField
              name="finalAllowReplay"
              defaultChecked={campaign.finalAllowReplay}
              className={CHECKBOX_INPUT_CLASS}
              labelClassName={CHECKBOX_TILE_CLASS}
            >
              Permitir jogar novamente
            </CheckboxField>
            <CheckboxField
              name="finalAllowShare"
              defaultChecked={campaign.finalAllowShare}
              className={CHECKBOX_INPUT_CLASS}
              labelClassName={CHECKBOX_TILE_CLASS}
            >
              Permitir partilhar o resultado
            </CheckboxField>
          </div>

          <p className="text-xs leading-relaxed text-caetano-anthracite-80">
            O regulamento e o texto legal definidos no ecrã inicial ficam disponíveis por link em
            todos os ecrãs públicos, incluindo este.
          </p>
        </FieldGroup>
      </AutoSaveForm>
    </div>
  );
}
