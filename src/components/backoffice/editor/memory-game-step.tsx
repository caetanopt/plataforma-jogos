import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { prisma } from "@/server/db/client";
import {
  addMemoryPairAction,
  moveMemoryPairAction,
  removeMemoryPairAction,
  updateMemoryConfigAction,
} from "@/features/memory-game/actions";
import { MEMORY_CONFIG_LIMITS } from "@/lib/validation/memory-game";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { MemoryPairForm } from "@/components/backoffice/editor/memory-pair-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import {
  ADD_PANEL_CLASS,
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_TILE_CLASS,
  FieldGroup,
  HELP_CLASS,
  ICON_BUTTON_CLASS,
  LIST_ITEM_CLASS,
  ListEmpty,
  SectionHeading,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
} from "@/components/backoffice/editor/editor-ui";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowLeftRight, ArrowUp, Layers } from "lucide-react";

const PAIR_KIND_LABELS = {
  SAME_IMAGE: "Imagens iguais",
  DIFFERENT_IMAGE_MATCH: "Imagens associadas",
  IMAGE_TEXT: "Imagem + texto",
  TEXT_TEXT: "Texto + texto",
};

/** "Remover" numa linha: discreto até ao rato, sempre no vermelho funcional de destruição. */
const REMOVE_BUTTON_CLASS = "text-danger hover:bg-danger-surface hover:text-danger-strong active:bg-danger-surface";

const L = MEMORY_CONFIG_LIMITS;

/** `notice`: um aviso da página, por baixo do título da etapa. */
export async function MemoryGameStep({ campaignId, notice }: { campaignId: string; notice?: ReactNode }) {
  // Mostra códigos de vouchers, pesos e respostas certas: a permissão é
  // verificada aqui também, e não só na página que o inclui.
  const context = await requirePagePermission("campaign:edit");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId, type: "MEMORY" },
    include: { memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } } },
  });
  if (!campaign?.memoryConfig) notFound();

  const { memoryConfig } = campaign;

  // O verso das cartas também: sem ele o campo não mostrava a imagem gravada.
  const mediaIds = [
    memoryConfig.cardBackMediaId,
    ...memoryConfig.pairs.flatMap((pair) => [pair.cardAMediaId, pair.cardBMediaId]),
  ].filter((v): v is string => Boolean(v));
  const mediaAssets = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, organizationId: context.organizationId } })
    : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));
  const cardBack = memoryConfig.cardBackMediaId ? mediaById.get(memoryConfig.cardBackMediaId) : undefined;

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Configuração do Jogo da Memória"
        description="Defina os pares de cartas, a grelha e as mecânicas de pontuação."
      />

      {notice}

      <AutoSaveForm action={updateMemoryConfigAction} className={cn(STEP_CARD_CLASS, "space-y-6")}>
        <input type="hidden" name="campaignId" value={campaign.id} />

        <FieldGroup title="Grelha">
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
            <div>
              <Label htmlFor="columns">Colunas</Label>
              <Input
                id="columns"
                name="columns"
                type="number"
                inputMode="numeric"
                min={L.columnsMin}
                max={L.columnsMax}
                step={1}
                defaultValue={memoryConfig.columns}
              />
            </div>
            <div>
              <Label htmlFor="cardAspectRatio">Proporção da carta</Label>
              <Input
                id="cardAspectRatio"
                name="cardAspectRatio"
                maxLength={L.cardAspectRatio}
                placeholder="3/4"
                aria-describedby="cardAspectRatio-help"
                defaultValue={memoryConfig.cardAspectRatio}
              />
              <p id="cardAspectRatio-help" className={HELP_CLASS}>
                Largura/altura, por exemplo 1/1 ou 3/4.
              </p>
            </div>
            <div>
              <Label htmlFor="cardGapPx">Espaçamento (px)</Label>
              <Input
                id="cardGapPx"
                name="cardGapPx"
                type="number"
                inputMode="numeric"
                min={0}
                max={L.cardGapMax}
                step={1}
                defaultValue={memoryConfig.cardGapPx}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Tempo e tentativas">
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
            <div>
              <Label htmlFor="timeLimitSeconds">Tempo limite (s)</Label>
              <Input
                id="timeLimitSeconds"
                name="timeLimitSeconds"
                type="number"
                inputMode="numeric"
                min={L.timeLimitMin}
                max={L.timeLimitMax}
                step={1}
                placeholder="Sem limite"
                defaultValue={memoryConfig.timeLimitSeconds ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="maxAttempts">Máximo de tentativas</Label>
              <Input
                id="maxAttempts"
                name="maxAttempts"
                type="number"
                inputMode="numeric"
                min={L.maxAttemptsMin}
                max={L.maxAttemptsMax}
                step={1}
                placeholder="Sem limite"
                defaultValue={memoryConfig.maxAttempts ?? ""}
              />
            </div>
            <div>
              <Label htmlFor="previewSeconds">Pré-visualização inicial (s)</Label>
              <Input
                id="previewSeconds"
                name="previewSeconds"
                type="number"
                inputMode="numeric"
                min={0}
                max={L.previewMax}
                step={1}
                placeholder="Sem pré-visualização"
                defaultValue={memoryConfig.previewSeconds ?? ""}
              />
            </div>
          </div>
        </FieldGroup>

        <FieldGroup title="Pontuação e ranking">
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 sm:grid-cols-3">
            <div>
              <Label htmlFor="pointsPerPair">Pontos por par</Label>
              <Input
                id="pointsPerPair"
                name="pointsPerPair"
                type="number"
                inputMode="numeric"
                min={0}
                max={L.pointsMax}
                step={1}
                defaultValue={memoryConfig.pointsPerPair}
              />
            </div>
            <div>
              <Label htmlFor="penaltyPerMistake">Penalização por erro</Label>
              <Input
                id="penaltyPerMistake"
                name="penaltyPerMistake"
                type="number"
                inputMode="numeric"
                min={0}
                max={L.penaltyMax}
                step={1}
                defaultValue={memoryConfig.penaltyPerMistake}
              />
            </div>
            <div>
              <Label htmlFor="rankingMaxEntries">Limite do ranking</Label>
              <Input
                id="rankingMaxEntries"
                name="rankingMaxEntries"
                type="number"
                inputMode="numeric"
                min={L.rankingMin}
                max={L.rankingMax}
                step={1}
                placeholder="10"
                defaultValue={memoryConfig.rankingMaxEntries ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:grid-cols-3">
            {(
              [
                ["randomizeOrder", "Ordem aleatória", memoryConfig.randomizeOrder],
                ["speedBonusEnabled", "Bónus por rapidez", memoryConfig.speedBonusEnabled],
                ["soundEnabled", "Sons", memoryConfig.soundEnabled],
                ["rankingEnabled", "Ativar ranking", memoryConfig.rankingEnabled],
                ["rankingAnonymize", "Anonimizar ranking", memoryConfig.rankingAnonymize],
              ] as const
            ).map(([name, label, checked]) => (
              <CheckboxField
                key={name}
                name={name}
                defaultChecked={checked}
                className={CHECKBOX_INPUT_CLASS}
                labelClassName={CHECKBOX_TILE_CLASS}
              >
                {label}
              </CheckboxField>
            ))}
          </div>
        </FieldGroup>

        <FieldGroup title="Cartas">
          <MediaUploadField
            name="cardBackMediaId"
            label="Verso das cartas"
            defaultMediaId={memoryConfig.cardBackMediaId}
            defaultUrl={cardBack?.url}
            defaultKind={cardBack?.kind}
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
          />
        </FieldGroup>
      </AutoSaveForm>

      <section aria-labelledby="memory-pairs-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <SectionHeading id="memory-pairs-heading" title={`Pares de cartas (${memoryConfig.pairs.length})`} />

        {memoryConfig.pairs.length === 0 ? (
          <ListEmpty icon={<Layers size={20} />}>Ainda não há pares de cartas. Adicione o primeiro abaixo.</ListEmpty>
        ) : (
          <ul className="space-y-2">
            {memoryConfig.pairs.map((pair, index) => (
              <li key={pair.id} className={cn(LIST_ITEM_CLASS, "flex flex-wrap items-center justify-between gap-3")}>
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-caetano-medium-gray-20 text-xs font-bold text-caetano-deep-blue"
                  >
                    {index + 1}
                  </span>
                  <PairThumb
                    url={pair.cardAMediaId ? mediaById.get(pair.cardAMediaId)?.url : undefined}
                    text={pair.cardAText}
                    label={pair.cardAAltText || `Par ${index + 1}, carta A`}
                  />
                  <ArrowLeftRight size={16} aria-hidden="true" className="shrink-0 text-caetano-anthracite-80" />
                  <PairThumb
                    url={pair.cardBMediaId ? mediaById.get(pair.cardBMediaId)?.url : undefined}
                    text={pair.cardBText}
                    label={pair.cardBAltText || `Par ${index + 1}, carta B`}
                  />
                  <span className="rounded-full bg-caetano-medium-gray-20 px-2 py-0.5 text-xs text-caetano-anthracite-80">
                    {PAIR_KIND_LABELS[pair.kind]}
                  </span>
                </div>
                <div className="ml-auto flex items-start gap-1">
                  <ActionForm action={moveMemoryPairAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="pairId" value={pair.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button
                      type="submit"
                      disabled={index === 0}
                      className={ICON_BUTTON_CLASS}
                      aria-label={`Mover o par ${index + 1} para cima`}
                    >
                      <ArrowUp size={16} aria-hidden="true" />
                    </button>
                  </ActionForm>
                  <ActionForm action={moveMemoryPairAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="pairId" value={pair.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button
                      type="submit"
                      disabled={index === memoryConfig.pairs.length - 1}
                      className={ICON_BUTTON_CLASS}
                      aria-label={`Mover o par ${index + 1} para baixo`}
                    >
                      <ArrowDown size={16} aria-hidden="true" />
                    </button>
                  </ActionForm>
                  <ActionForm action={removeMemoryPairAction} messageClassName="mt-1 max-w-48">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="pairId" value={pair.id} />
                    <ConfirmSubmitButton
                      confirmMessage={`Remover o par ${index + 1}?`}
                      variant="ghost"
                      size="md"
                      className={REMOVE_BUTTON_CLASS}
                    >
                      Remover
                    </ConfirmSubmitButton>
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className={ADD_PANEL_CLASS}>
          <h4 className="mb-3 text-sm font-bold text-caetano-deep-blue">Novo par</h4>
          <MemoryPairForm action={addMemoryPairAction} campaignId={campaign.id} />
        </div>
      </section>
    </div>
  );
}

function PairThumb({ url, text, label }: { url?: string; text?: string | null; label: string }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={label}
        className="h-12 w-12 rounded-lg border border-caetano-medium-gray-40 object-cover shadow-xs"
      />
    );
  }
  return (
    <span className="flex h-12 w-24 items-center justify-center overflow-hidden rounded-lg border border-caetano-medium-gray-40 bg-white px-2 text-center text-xs font-medium text-caetano-anthracite shadow-xs">
      <span className="line-clamp-2 break-words">{text || "—"}</span>
    </span>
  );
}
