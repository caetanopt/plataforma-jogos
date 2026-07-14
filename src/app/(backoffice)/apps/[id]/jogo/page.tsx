import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  moveMemoryPairAction,
  removeMemoryPairAction,
  updateMemoryConfigAction,
} from "@/features/memory-game/actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { MemoryPairForm } from "@/components/backoffice/editor/memory-pair-form";
import { StepPlaceholder } from "@/components/backoffice/editor/step-placeholder";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

const PAIR_KIND_LABELS = {
  SAME_IMAGE: "Imagens iguais",
  DIFFERENT_IMAGE_MATCH: "Imagens associadas",
  IMAGE_TEXT: "Imagem + texto",
  TEXT_TEXT: "Texto + texto",
};

async function MemoryGameStep({ campaignId }: { campaignId: string }) {
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId, type: "MEMORY" },
    include: { memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } } },
  });
  if (!campaign?.memoryConfig) notFound();

  const { memoryConfig } = campaign;

  const mediaIds = memoryConfig.pairs.flatMap((pair) =>
    [pair.cardAMediaId, pair.cardBMediaId].filter((v): v is string => Boolean(v)),
  );
  const mediaAssets = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } })
    : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-caetano-anthracite">
            Configuração do Jogo da Memória
          </h2>
          <p className="mt-1 text-sm text-caetano-medium-gray">
            Defina os pares de cartas, a grelha e as mecânicas de pontuação.
          </p>
        </div>
        <Link
          href={`/apps/${campaign.id}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-neutral-100"
        >
          Pré-visualizar
        </Link>
      </div>

      <AutoSaveForm
        action={updateMemoryConfigAction}
        className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
      >
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="columns">Colunas</Label>
            <Input id="columns" name="columns" type="number" min={2} max={8} defaultValue={memoryConfig.columns} />
          </div>
          <div>
            <Label htmlFor="cardAspectRatio">Proporção da carta</Label>
            <Input id="cardAspectRatio" name="cardAspectRatio" defaultValue={memoryConfig.cardAspectRatio} />
          </div>
          <div>
            <Label htmlFor="cardGapPx">Espaçamento (px)</Label>
            <Input id="cardGapPx" name="cardGapPx" type="number" min={0} max={64} defaultValue={memoryConfig.cardGapPx} />
          </div>
          <div>
            <Label htmlFor="timeLimitSeconds">Tempo limite (s)</Label>
            <Input
              id="timeLimitSeconds"
              name="timeLimitSeconds"
              type="number"
              min={0}
              defaultValue={memoryConfig.timeLimitSeconds ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="maxAttempts">Máx. tentativas</Label>
            <Input
              id="maxAttempts"
              name="maxAttempts"
              type="number"
              min={0}
              defaultValue={memoryConfig.maxAttempts ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="previewSeconds">Pré-visualização inicial (s)</Label>
            <Input
              id="previewSeconds"
              name="previewSeconds"
              type="number"
              min={0}
              max={30}
              defaultValue={memoryConfig.previewSeconds ?? ""}
            />
          </div>
          <div>
            <Label htmlFor="pointsPerPair">Pontos por par</Label>
            <Input id="pointsPerPair" name="pointsPerPair" type="number" min={0} defaultValue={memoryConfig.pointsPerPair} />
          </div>
          <div>
            <Label htmlFor="penaltyPerMistake">Penalização por erro</Label>
            <Input
              id="penaltyPerMistake"
              name="penaltyPerMistake"
              type="number"
              min={0}
              defaultValue={memoryConfig.penaltyPerMistake}
            />
          </div>
          <div>
            <Label htmlFor="rankingMaxEntries">Limite do ranking</Label>
            <Input
              id="rankingMaxEntries"
              name="rankingMaxEntries"
              type="number"
              min={1}
              defaultValue={memoryConfig.rankingMaxEntries ?? ""}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input type="checkbox" name="randomizeOrder" defaultChecked={memoryConfig.randomizeOrder} className="h-4 w-4 rounded border-caetano-medium-gray" />
            Ordem aleatória
          </label>
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input type="checkbox" name="speedBonusEnabled" defaultChecked={memoryConfig.speedBonusEnabled} className="h-4 w-4 rounded border-caetano-medium-gray" />
            Bónus por rapidez
          </label>
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input type="checkbox" name="soundEnabled" defaultChecked={memoryConfig.soundEnabled} className="h-4 w-4 rounded border-caetano-medium-gray" />
            Sons
          </label>
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input type="checkbox" name="rankingEnabled" defaultChecked={memoryConfig.rankingEnabled} className="h-4 w-4 rounded border-caetano-medium-gray" />
            Ativar ranking
          </label>
          <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
            <input type="checkbox" name="rankingAnonymize" defaultChecked={memoryConfig.rankingAnonymize} className="h-4 w-4 rounded border-caetano-medium-gray" />
            Anonimizar ranking
          </label>
        </div>

        <MediaUploadField
          name="cardBackMediaId"
          label="Verso das cartas"
          defaultMediaId={memoryConfig.cardBackMediaId}
          defaultUrl={memoryConfig.cardBackMediaId ? mediaById.get(memoryConfig.cardBackMediaId)?.url : undefined}
          defaultKind={memoryConfig.cardBackMediaId ? mediaById.get(memoryConfig.cardBackMediaId)?.kind : undefined}
          accept="image/jpeg,image/png,image/webp,image/svg+xml"
        />

        <SaveStatus />
      </AutoSaveForm>

      <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">
          Pares de cartas ({memoryConfig.pairs.length})
        </h3>

        <ul className="space-y-2">
          {memoryConfig.pairs.map((pair, index) => (
            <li key={pair.id} className="flex items-center justify-between gap-3 rounded-lg border border-caetano-medium-gray/20 p-2">
              <div className="flex items-center gap-3">
                <PairThumb url={pair.cardAMediaId ? mediaById.get(pair.cardAMediaId)?.url : undefined} text={pair.cardAText} />
                <span className="text-caetano-medium-gray">↔</span>
                <PairThumb url={pair.cardBMediaId ? mediaById.get(pair.cardBMediaId)?.url : undefined} text={pair.cardBText} />
                <span className="text-xs text-caetano-medium-gray">{PAIR_KIND_LABELS[pair.kind]}</span>
              </div>
              <div className="flex items-center gap-1">
                <form action={moveMemoryPairAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button type="submit" disabled={index === 0} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para cima">
                    ↑
                  </button>
                </form>
                <form action={moveMemoryPairAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button type="submit" disabled={index === memoryConfig.pairs.length - 1} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para baixo">
                    ↓
                  </button>
                </form>
                <form action={removeMemoryPairAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="pairId" value={pair.id} />
                  <ConfirmSubmitButton confirmMessage="Remover este par?" size="sm">
                    Remover
                  </ConfirmSubmitButton>
                </form>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <MemoryPairForm campaignId={campaign.id} />
        </div>
      </div>
    </div>
  );
}

function PairThumb({ url, text }: { url?: string; text?: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-12 w-12 rounded object-cover" />;
  }
  return (
    <span className="flex h-12 w-24 items-center justify-center rounded bg-neutral-100 px-2 text-xs text-caetano-anthracite">
      {text || "—"}
    </span>
  );
}

export default async function GameConfigStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    select: { type: true },
  });
  if (!campaign) notFound();

  if (campaign.type === "MEMORY") {
    return <MemoryGameStep campaignId={id} />;
  }

  return <StepPlaceholder title="Configuração do jogo" />;
}
