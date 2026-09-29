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
import { FINAL_SCREEN_LIMITS } from "@/lib/validation/campaign";

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
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-caetano-anthracite">Resultado e ecrã final</h2>
        <p className="mt-1 text-sm text-caetano-anthracite-80">
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
        className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

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

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
          <CheckboxField name="finalAllowReplay" defaultChecked={campaign.finalAllowReplay}>
            Permitir jogar novamente
          </CheckboxField>
          <CheckboxField name="finalAllowShare" defaultChecked={campaign.finalAllowShare}>
            Permitir partilhar o resultado
          </CheckboxField>
        </div>

        <p className="text-xs text-caetano-anthracite-80">
          O regulamento e o texto legal definidos no ecrã inicial ficam disponíveis por link em
          todos os ecrãs públicos, incluindo este.
        </p>
      </AutoSaveForm>
    </div>
  );
}
