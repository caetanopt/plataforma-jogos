import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateStartScreenAction } from "@/features/campaigns/steps/start-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import {
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_TILE_CLASS,
  FieldGroup,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { START_SCREEN_LIMITS } from "@/lib/validation/campaign";
import { cn } from "@/lib/utils";

export default async function StartScreenStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const [startMedia, startLogo] = await Promise.all([
    campaign.startMediaId ? prisma.mediaAsset.findFirst({ where: { id: campaign.startMediaId, organizationId: context.organizationId } }) : null,
    campaign.startLogoMediaId
      ? prisma.mediaAsset.findFirst({ where: { id: campaign.startLogoMediaId, organizationId: context.organizationId } })
      : null,
  ]);

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader title="Ecrã inicial" description="O primeiro ecrã que os participantes veem antes de jogar." />

      <AutoSaveForm action={updateStartScreenAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <FieldGroup title="Textos">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="startTitle">Título</Label>
              <Input id="startTitle" name="startTitle" maxLength={START_SCREEN_LIMITS.startTitle} defaultValue={campaign.startTitle ?? ""} />
            </div>

            <div>
              <Label htmlFor="startSubtitle">Subtítulo</Label>
              <Input id="startSubtitle" name="startSubtitle" maxLength={START_SCREEN_LIMITS.startSubtitle} defaultValue={campaign.startSubtitle ?? ""} />
            </div>
          </div>

          <div>
            <Label htmlFor="startIntroText">Texto introdutório</Label>
            <textarea
              id="startIntroText"
              name="startIntroText"
              maxLength={START_SCREEN_LIMITS.startIntroText}
              defaultValue={campaign.startIntroText ?? ""}
              rows={3}
              className={TEXTAREA_CLASS}
            />
          </div>
        </FieldGroup>

        <FieldGroup title="Imagem e logótipo">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <MediaUploadField
              name="startMediaId"
              label="Imagem ou vídeo"
              defaultMediaId={campaign.startMediaId}
              defaultUrl={startMedia?.url}
              defaultKind={startMedia?.kind}
              helpText="JPG, PNG, WebP, GIF ou MP4 — até 20 MB (100 MB para vídeo)."
            />

            <MediaUploadField
              name="startLogoMediaId"
              label="Logótipo"
              defaultMediaId={campaign.startLogoMediaId}
              defaultUrl={startLogo?.url}
              defaultKind={startLogo?.kind}
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
            />
          </div>
        </FieldGroup>

        <FieldGroup title="Botão e prémio">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="startButtonLabel">Botão principal</Label>
              <Input
                id="startButtonLabel"
                name="startButtonLabel"
                maxLength={START_SCREEN_LIMITS.startButtonLabel}
                placeholder="Jogar agora"
                defaultValue={campaign.startButtonLabel ?? ""}
              />
            </div>

            <div>
              <Label htmlFor="startPrizeInfo">Informação sobre prémio</Label>
              <Input id="startPrizeInfo" name="startPrizeInfo" maxLength={START_SCREEN_LIMITS.startPrizeInfo} defaultValue={campaign.startPrizeInfo ?? ""} />
            </div>
          </div>

          <CheckboxField
            name="countdownEnabled"
            defaultChecked={campaign.countdownEnabled}
            className={CHECKBOX_INPUT_CLASS}
            labelClassName={CHECKBOX_TILE_CLASS}
          >
            Mostrar contagem decrescente até à data de término (definida na etapa Agenda)
          </CheckboxField>
        </FieldGroup>

        <FieldGroup title="Regulamento e texto legal">
          <div>
            <Label htmlFor="regulationText">Regulamento</Label>
            <textarea
              id="regulationText"
              name="regulationText"
              maxLength={START_SCREEN_LIMITS.regulationText}
              defaultValue={campaign.regulationText ?? ""}
              rows={4}
              className={TEXTAREA_CLASS}
            />
          </div>

          <div>
            <Label htmlFor="legalText">Texto legal</Label>
            <textarea
              id="legalText"
              name="legalText"
              maxLength={START_SCREEN_LIMITS.legalText}
              defaultValue={campaign.legalText ?? ""}
              rows={2}
              className={TEXTAREA_CLASS}
            />
          </div>
        </FieldGroup>
      </AutoSaveForm>
    </div>
  );
}
