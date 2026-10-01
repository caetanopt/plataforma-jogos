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
import {
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_TILE_CLASS,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { SCREEN_LIMITS } from "@/lib/validation/campaign";
import { cn } from "@/lib/utils";
import type { ScreenKind } from "@/generated/prisma/client";
import { Flag, Play, type LucideIcon } from "lucide-react";

const SECTIONS: Array<{ kind: ScreenKind; title: string; help: string; icon: LucideIcon }> = [
  {
    kind: "INTERMEDIATE_BEFORE",
    icon: Play,
    title: "Ecrã antes do jogo",
    help: "Mostrado depois do ecrã inicial (e do formulário, se estiver antes do jogo) e antes de começar a jogar.",
  },
  {
    kind: "INTERMEDIATE_AFTER",
    icon: Flag,
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
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Ecrãs intermédios"
        description="Opcional. No máximo um ecrã antes do jogo e um depois do jogo."
      />

      {SECTIONS.map((section) => {
        const screen = campaign.screens.find((s) => s.kind === section.kind);
        const media = screen?.mediaId ? mediaById.get(screen.mediaId) : undefined;
        const ids = (field: string) => `${section.kind}-${field}`;
        const Icon = section.icon;

        return (
          <AutoSaveForm key={section.kind} action={updateIntermediateScreenAction} className={cn(STEP_CARD_CLASS, "space-y-5")}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input type="hidden" name="kind" value={section.kind} />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-caetano-cyan-20 text-caetano-deep-blue"
                >
                  <Icon size={18} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-caetano-deep-blue">{section.title}</h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-caetano-anthracite-80 sm:text-sm">{section.help}</p>
                </div>
              </div>
              {/* Um ecrã que ainda não foi gravado está desligado. */}
              <CheckboxField
                name="enabled"
                id={ids("enabled")}
                defaultChecked={screen?.enabled ?? false}
                aria-describedby={ids("enabled-help")}
                className={CHECKBOX_INPUT_CLASS}
                labelClassName={cn(CHECKBOX_TILE_CLASS, "shrink-0 self-start font-medium")}
              >
                Ativar<span className="sr-only"> o {section.title.toLowerCase()}</span>
              </CheckboxField>
            </div>
            <p id={ids("enabled-help")} className="rounded-lg bg-caetano-medium-gray-20 px-3 py-2 text-xs leading-relaxed text-caetano-anthracite-80">
              Desativado, o ecrã não é mostrado aos participantes, mas o conteúdo fica guardado para quando o
              voltar a ativar.
            </p>

            <div className="space-y-4 border-t border-caetano-medium-gray-40 pt-5">
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
                  className={TEXTAREA_CLASS}
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
            </div>
          </AutoSaveForm>
        );
      })}
    </div>
  );
}
