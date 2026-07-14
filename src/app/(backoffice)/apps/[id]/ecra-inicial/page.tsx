import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateStartScreenAction } from "@/features/campaigns/steps/start-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export default async function StartScreenStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const [startMedia, startLogo] = await Promise.all([
    campaign.startMediaId ? prisma.mediaAsset.findUnique({ where: { id: campaign.startMediaId } }) : null,
    campaign.startLogoMediaId
      ? prisma.mediaAsset.findUnique({ where: { id: campaign.startLogoMediaId } })
      : null,
  ]);

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-caetano-anthracite">Ecrã inicial</h2>
      <p className="mt-1 text-sm text-caetano-medium-gray">
        O primeiro ecrã que os participantes veem antes de jogar.
      </p>

      <AutoSaveForm action={updateStartScreenAction} className="mt-6 space-y-4">
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div>
          <Label htmlFor="startTitle">Título</Label>
          <Input id="startTitle" name="startTitle" defaultValue={campaign.startTitle ?? ""} />
        </div>

        <div>
          <Label htmlFor="startSubtitle">Subtítulo</Label>
          <Input id="startSubtitle" name="startSubtitle" defaultValue={campaign.startSubtitle ?? ""} />
        </div>

        <div>
          <Label htmlFor="startIntroText">Texto introdutório</Label>
          <textarea
            id="startIntroText"
            name="startIntroText"
            defaultValue={campaign.startIntroText ?? ""}
            rows={3}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

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

        <div>
          <Label htmlFor="startButtonLabel">Botão principal</Label>
          <Input
            id="startButtonLabel"
            name="startButtonLabel"
            placeholder="Jogar agora"
            defaultValue={campaign.startButtonLabel ?? ""}
          />
        </div>

        <div>
          <Label htmlFor="startPrizeInfo">Informação sobre prémio</Label>
          <Input id="startPrizeInfo" name="startPrizeInfo" defaultValue={campaign.startPrizeInfo ?? ""} />
        </div>

        <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
          <input
            type="checkbox"
            name="countdownEnabled"
            defaultChecked={campaign.countdownEnabled}
            className="h-4 w-4 rounded border-caetano-medium-gray"
          />
          Mostrar contagem decrescente até à data de término (definida na etapa Agenda)
        </label>

        <div>
          <Label htmlFor="regulationText">Regulamento</Label>
          <textarea
            id="regulationText"
            name="regulationText"
            defaultValue={campaign.regulationText ?? ""}
            rows={4}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <div>
          <Label htmlFor="legalText">Texto legal</Label>
          <textarea
            id="legalText"
            name="legalText"
            defaultValue={campaign.legalText ?? ""}
            rows={2}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <SaveStatus />
      </AutoSaveForm>
    </div>
  );
}
