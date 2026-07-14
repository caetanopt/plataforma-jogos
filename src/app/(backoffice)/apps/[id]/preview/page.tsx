import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { MemoryGamePreview } from "@/components/public-game/memory-game-preview";
import { WheelGamePreview } from "@/components/public-game/wheel-game-preview";

export default async function CampaignPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } },
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      prizes: true,
    },
  });
  if (!campaign) notFound();

  let mediaById = new Map<string, { url: string }>();
  if (campaign.memoryConfig) {
    const mediaIds = campaign.memoryConfig.pairs.flatMap((pair) =>
      [pair.cardAMediaId, pair.cardBMediaId, campaign.memoryConfig?.cardBackMediaId].filter(
        (v): v is string => Boolean(v),
      ),
    );
    if (mediaIds.length) {
      const mediaAssets = await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } });
      mediaById = new Map(mediaAssets.map((m) => [m.id, m]));
    }
  }

  const prizeById = new Map(campaign.prizes.map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 rounded-lg border border-caetano-cyan/40 bg-caetano-cyan/10 px-4 py-2 text-center text-sm text-caetano-deep-blue">
        Pré-visualização — simulação local, não afeta estatísticas nem participações.
      </div>

      {campaign.type === "MEMORY" && campaign.memoryConfig ? (
        <MemoryGamePreview
          pairs={campaign.memoryConfig.pairs.map((pair) => ({
            id: pair.id,
            cardAMediaUrl: pair.cardAMediaId ? mediaById.get(pair.cardAMediaId)?.url : undefined,
            cardAText: pair.cardAText,
            cardAAlt: pair.cardAAltText,
            cardBMediaUrl: pair.cardBMediaId ? mediaById.get(pair.cardBMediaId)?.url : undefined,
            cardBText: pair.cardBText,
            cardBAlt: pair.cardBAltText,
          }))}
          config={{
            columns: campaign.memoryConfig.columns,
            randomizeOrder: campaign.memoryConfig.randomizeOrder,
            cardGapPx: campaign.memoryConfig.cardGapPx,
            timeLimitSeconds: campaign.memoryConfig.timeLimitSeconds,
            maxAttempts: campaign.memoryConfig.maxAttempts,
            previewSeconds: campaign.memoryConfig.previewSeconds,
            cardBackUrl: campaign.memoryConfig.cardBackMediaId
              ? mediaById.get(campaign.memoryConfig.cardBackMediaId)?.url
              : undefined,
          }}
          scoringConfig={{
            pointsPerPair: campaign.memoryConfig.pointsPerPair,
            penaltyPerMistake: campaign.memoryConfig.penaltyPerMistake,
            speedBonusEnabled: campaign.memoryConfig.speedBonusEnabled,
            timeLimitSeconds: campaign.memoryConfig.timeLimitSeconds,
            maxAttempts: campaign.memoryConfig.maxAttempts,
          }}
        />
      ) : campaign.type === "WHEEL" && campaign.wheelConfig ? (
        <WheelGamePreview
          segments={campaign.wheelConfig.segments
            .filter((segment) => segment.isActive)
            .map((segment) => ({
              id: segment.id,
              name: segment.name,
              colorHex: segment.colorHex,
              weight: segment.weight,
              outcome: segment.outcome,
              message: segment.message,
              prizeName: segment.prizeId ? (prizeById.get(segment.prizeId)?.publicName ?? null) : null,
            }))}
        />
      ) : (
        <p className="text-center text-sm text-caetano-medium-gray">
          Pré-visualização ainda não disponível para este tipo de jogo.
        </p>
      )}
    </div>
  );
}
