import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateIntermediateScreenAction } from "@/features/campaigns/steps/intermediate-screen-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { SCREEN_LIMITS } from "@/lib/validation/campaign";
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
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const mediaIds = campaign.screens.map((screen) => screen.mediaId).filter((v): v is string => Boolean(v));
  const mediaAssets = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, organizationId: context.organizationId } })
    : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-lg font-bold text-caetano-anthracite">Ecrãs intermédios</h2>
        <p className="mt-1 text-sm text-caetano-anthracite-80">
          Opcional. No máximo um ecrã antes do jogo e um depois do jogo.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const screen = campaign.screens.find((s) => s.kind === section.kind);
        const media = screen?.mediaId ? mediaById.get(screen.mediaId) : undefined;
        const ids = (field: string) => `${section.kind}-${field}`;

        return (
          <AutoSaveForm
            key={section.kind}
            action={updateIntermediateScreenAction}
            className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
          >
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="kind" value={section.kind} />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div>
                <h3 className="font-medium text-caetano-anthracite">{section.title}</h3>
                <p className="mt-0.5 text-xs text-caetano-anthracite-80">{section.help}</p>
              </div>
              {/* Um ecrã que ainda não foi gravado está desligado. */}
              <CheckboxField
                name="enabled"
                id={ids("enabled")}
                defaultChecked={screen?.enabled ?? false}
                aria-describedby={ids("enabled-help")}
                labelClassName="flex min-h-6 shrink-0 items-center gap-2 text-sm text-caetano-anthracite"
              >
                Ativar<span className="sr-only"> o {section.title.toLowerCase()}</span>
              </CheckboxField>
            </div>
            <p id={ids("enabled-help")} className="text-xs text-caetano-anthracite-80">
              Desativado, o ecrã não é mostrado aos participantes, mas o conteúdo fica guardado para quando o
              voltar a ativar.
            </p>

            <div>
              <Label htmlFor={ids("title")}>Título</Label>
              <Input id={ids("title")} name="title" maxLength={SCREEN_LIMITS.title} defaultValue={screen?.title ?? ""} />
            </div>

            <div>
              <Label htmlFor={ids("text")}>Texto</Label>
              <textarea
                id={ids("text")}
                name="text"
                maxLength={SCREEN_LIMITS.text}
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

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids("ctaLabel")}>Texto do botão de ação (opcional)</Label>
                <Input
                  id={ids("ctaLabel")}
                  name="ctaLabel"
                  maxLength={SCREEN_LIMITS.ctaLabel}
                  defaultValue={screen?.ctaLabel ?? ""}
                />
              </div>
              <div>
                <Label htmlFor={ids("ctaUrl")}>Link do botão de ação (opcional)</Label>
                <Input
                  id={ids("ctaUrl")}
                  name="ctaUrl"
                  type="url"
                  inputMode="url"
                  maxLength={SCREEN_LIMITS.ctaUrl}
                  placeholder="https://"
                  defaultValue={screen?.ctaUrl ?? ""}
                />
              </div>
            </div>

            <div>
              <Label htmlFor={ids("continueButtonLabel")}>Texto do botão continuar</Label>
              <Input
                id={ids("continueButtonLabel")}
                name="continueButtonLabel"
                maxLength={SCREEN_LIMITS.continueButtonLabel}
                placeholder="Continuar"
                defaultValue={screen?.continueButtonLabel ?? ""}
              />
            </div>
          </AutoSaveForm>
        );
      })}
    </div>
  );
}
