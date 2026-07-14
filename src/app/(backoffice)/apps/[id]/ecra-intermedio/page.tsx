import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateIntermediateScreenAction } from "@/features/campaigns/steps/intermediate-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ScreenKind } from "@/generated/prisma/client";

const SECTIONS: Array<{ kind: ScreenKind; title: string; help: string }> = [
  {
    kind: "INTERMEDIATE_BEFORE",
    title: "Ecrã antes do jogo",
    help: "Mostrado depois do ecrã inicial (e do formulário, se estiver antes do jogo) e antes de começar a jogar.",
  },
  {
    kind: "INTERMEDIATE_AFTER",
    title: "Ecrã depois do jogo",
    help: "Mostrado depois de terminar o jogo e antes do ecrã de resultado final.",
  },
];

export default async function IntermediateScreenStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const mediaIds = campaign.screens.map((screen) => screen.mediaId).filter((v): v is string => Boolean(v));
  const mediaAssets = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } })
    : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Ecrãs intermédios</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Opcional. No máximo um ecrã antes do jogo e um depois do jogo.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const screen = campaign.screens.find((s) => s.kind === section.kind);
        const media = screen?.mediaId ? mediaById.get(screen.mediaId) : undefined;

        return (
          <AutoSaveForm
            key={section.kind}
            action={updateIntermediateScreenAction}
            className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
          >
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="kind" value={section.kind} />

            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-caetano-anthracite">{section.title}</h3>
                <p className="mt-0.5 text-xs text-caetano-medium-gray">{section.help}</p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-caetano-anthracite">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={Boolean(screen)}
                  className="h-4 w-4 rounded border-caetano-medium-gray"
                />
                Ativar
              </label>
            </div>

            <div>
              <Label htmlFor={`${section.kind}-title`}>Título</Label>
              <Input id={`${section.kind}-title`} name="title" defaultValue={screen?.title ?? ""} />
            </div>

            <div>
              <Label htmlFor={`${section.kind}-text`}>Texto</Label>
              <textarea
                id={`${section.kind}-text`}
                name="text"
                defaultValue={screen?.text ?? ""}
                rows={3}
                className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
              />
            </div>

            <MediaUploadField
              name="mediaId"
              label="Imagem ou vídeo"
              defaultMediaId={screen?.mediaId}
              defaultUrl={media?.url}
              defaultKind={media?.kind}
              helpText="JPG, PNG, WebP, GIF ou MP4 — até 20 MB (100 MB para vídeo)."
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor={`${section.kind}-ctaLabel`}>Texto do botão CTA (opcional)</Label>
                <Input id={`${section.kind}-ctaLabel`} name="ctaLabel" defaultValue={screen?.ctaLabel ?? ""} />
              </div>
              <div>
                <Label htmlFor={`${section.kind}-ctaUrl`}>Link do CTA (opcional)</Label>
                <Input id={`${section.kind}-ctaUrl`} name="ctaUrl" defaultValue={screen?.ctaUrl ?? ""} />
              </div>
            </div>

            <div>
              <Label htmlFor={`${section.kind}-continueButtonLabel`}>Texto do botão continuar</Label>
              <Input
                id={`${section.kind}-continueButtonLabel`}
                name="continueButtonLabel"
                placeholder="Continuar"
                defaultValue={screen?.continueButtonLabel ?? ""}
              />
            </div>

            <SaveStatus />
          </AutoSaveForm>
        );
      })}
    </div>
  );
}
