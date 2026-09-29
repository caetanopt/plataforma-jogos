import Link from "next/link";
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

const PAIR_KIND_LABELS = {
  SAME_IMAGE: "Imagens iguais",
  DIFFERENT_IMAGE_MATCH: "Imagens associadas",
  IMAGE_TEXT: "Imagem + texto",
  TEXT_TEXT: "Texto + texto",
};

const MOVE_BUTTON_CLASS =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-30";

const L = MEMORY_CONFIG_LIMITS;

export async function MemoryGameStep({ campaignId }: { campaignId: string }) {
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
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-caetano-anthracite">
            Configuração do Jogo da Memória
          </h2>
          <p className="mt-1 text-sm text-caetano-anthracite-80">
            Defina os pares de cartas, a grelha e as mecânicas de pontuação.
          </p>
        </div>
        <Link
          href={`/apps/${campaign.id}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-caetano-medium-gray-20"
        >
          Pré-visualizar
        </Link>
      </div>

      <AutoSaveForm
        action={updateMemoryConfigAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

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
            <p id="cardAspectRatio-help" className="mt-1 text-xs text-caetano-anthracite-80">
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

        <div className="flex flex-wrap gap-4">
          <CheckboxField name="randomizeOrder" defaultChecked={memoryConfig.randomizeOrder}>
            Ordem aleatória
          </CheckboxField>
          <CheckboxField name="speedBonusEnabled" defaultChecked={memoryConfig.speedBonusEnabled}>
            Bónus por rapidez
          </CheckboxField>
          <CheckboxField name="soundEnabled" defaultChecked={memoryConfig.soundEnabled}>
            Sons
          </CheckboxField>
          <CheckboxField name="rankingEnabled" defaultChecked={memoryConfig.rankingEnabled}>
            Ativar ranking
          </CheckboxField>
          <CheckboxField name="rankingAnonymize" defaultChecked={memoryConfig.rankingAnonymize}>
            Anonimizar ranking
          </CheckboxField>
        </div>

        <MediaUploadField
          name="cardBackMediaId"
          label="Verso das cartas"
          defaultMediaId={memoryConfig.cardBackMediaId}
          defaultUrl={cardBack?.url}
          defaultKind={cardBack?.kind}
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
        />
      </AutoSaveForm>

      <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">
          Pares de cartas ({memoryConfig.pairs.length})
        </h3>

        {memoryConfig.pairs.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-anthracite-80">
            Ainda não há pares de cartas. Adicione o primeiro abaixo.
          </p>
        )}

        <ul className="space-y-2">
          {memoryConfig.pairs.map((pair, index) => (
            <li
              key={pair.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-caetano-medium-gray-20 p-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                <PairThumb
                  url={pair.cardAMediaId ? mediaById.get(pair.cardAMediaId)?.url : undefined}
                  text={pair.cardAText}
                  label={pair.cardAAltText || `Par ${index + 1}, carta A`}
                />
                <span aria-hidden="true" className="text-caetano-anthracite-80">↔</span>
                <PairThumb
                  url={pair.cardBMediaId ? mediaById.get(pair.cardBMediaId)?.url : undefined}
                  text={pair.cardBText}
                  label={pair.cardBAltText || `Par ${index + 1}, carta B`}
                />
                <span className="text-xs text-caetano-anthracite-80">{PAIR_KIND_LABELS[pair.kind]}</span>
              </div>
              <div className="flex items-start gap-1">
                <ActionForm action={moveMemoryPairAction} messageClassName="mt-1 max-w-48">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    type="submit"
                    disabled={index === 0}
                    className={MOVE_BUTTON_CLASS}
                    aria-label={`Mover o par ${index + 1} para cima`}
                  >
                    ↑
                  </button>
                </ActionForm>
                <ActionForm action={moveMemoryPairAction} messageClassName="mt-1 max-w-48">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    disabled={index === memoryConfig.pairs.length - 1}
                    className={MOVE_BUTTON_CLASS}
                    aria-label={`Mover o par ${index + 1} para baixo`}
                  >
                    ↓
                  </button>
                </ActionForm>
                <ActionForm action={removeMemoryPairAction} messageClassName="mt-1 max-w-48">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <ConfirmSubmitButton confirmMessage={`Remover o par ${index + 1}?`} size="sm">
                    Remover
                  </ConfirmSubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <MemoryPairForm action={addMemoryPairAction} campaignId={campaign.id} />
        </div>
      </div>
    </div>
  );
}

function PairThumb({ url, text, label }: { url?: string; text?: string | null; label: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={label} className="h-12 w-12 rounded object-cover" />;
  }
  return (
    <span className="flex h-12 w-24 items-center justify-center rounded bg-caetano-medium-gray-20 px-2 text-xs text-caetano-anthracite">
      {text || "—"}
    </span>
  );
}
