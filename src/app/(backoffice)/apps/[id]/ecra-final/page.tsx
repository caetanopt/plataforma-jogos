import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateFinalScreenAction } from "@/features/campaigns/steps/final-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default async function FinalScreenStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const finalMedia = campaign.finalMediaId
    ? await prisma.mediaAsset.findUnique({ where: { id: campaign.finalMediaId } })
    : null;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Resultado e ecrã final</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          O último ecrã que os participantes veem, depois de jogar.
        </p>
      </div>

      <Alert variant="info">
        O resultado, a pontuação, o tempo, o prémio e o código atribuído são sempre calculados e
        apresentados automaticamente pelo motor de cada jogo — aqui configura apenas o conteúdo
        fixo à volta desse resultado.
      </Alert>

      <AutoSaveForm
        action={updateFinalScreenAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div>
          <Label htmlFor="finalTitle">Título</Label>
          <Input id="finalTitle" name="finalTitle" defaultValue={campaign.finalTitle ?? ""} />
        </div>

        <div>
          <Label htmlFor="finalMessage">Mensagem</Label>
          <textarea
            id="finalMessage"
            name="finalMessage"
            defaultValue={campaign.finalMessage ?? ""}
            rows={3}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="finalCtaLabel">Texto do botão CTA (opcional)</Label>
            <Input id="finalCtaLabel" name="finalCtaLabel" defaultValue={campaign.finalCtaLabel ?? ""} />
          </div>
          <div>
            <Label htmlFor="finalCtaUrl">Link do CTA (opcional)</Label>
            <Input id="finalCtaUrl" name="finalCtaUrl" defaultValue={campaign.finalCtaUrl ?? ""} />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input
              type="checkbox"
              name="finalAllowReplay"
              defaultChecked={campaign.finalAllowReplay}
              className="h-4 w-4 rounded border-caetano-medium-gray"
            />
            Permitir jogar novamente
          </label>
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input
              type="checkbox"
              name="finalAllowShare"
              defaultChecked={campaign.finalAllowShare}
              className="h-4 w-4 rounded border-caetano-medium-gray"
            />
            Permitir partilhar o resultado
          </label>
        </div>

        <p className="text-xs text-caetano-medium-gray">
          O regulamento e o texto legal definidos no ecrã inicial ficam disponíveis por link em
          todos os ecrãs públicos, incluindo este.
        </p>

        <SaveStatus />
      </AutoSaveForm>
    </div>
  );
}
