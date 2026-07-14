import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { canTestCampaign } from "@/features/play/test-mode";
import { PublicGameFlow, type PublicGameFlowProps } from "@/components/public-game/public-game-flow";

const STATE_MESSAGES: Record<string, string> = {
  paused: "Esta campanha está temporariamente pausada. Volte mais tarde.",
  expired: "Esta campanha já terminou. Obrigado pelo interesse!",
};

export default async function PublicPlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ test?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      screens: true,
      leadForm: { include: { fields: { orderBy: { order: "asc" } }, consentDefinitions: { orderBy: { order: "asc" } } } },
      memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } },
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      quizConfig: {
        include: {
          questions: { include: { answers: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          resultProfiles: { orderBy: { minPercentage: "asc" } },
        },
      },
    },
  });
  if (!campaign) notFound();

  const effectiveState = getEffectivePublicState(campaign);
  if (effectiveState === "unavailable") notFound();

  const isTestMode = search.test === "1" && (await canTestCampaign(campaign.organizationId));

  if (effectiveState === "before_schedule") {
    return (
      <StateMessage>{campaign.scheduleBeforeMessage || "Esta campanha ainda não começou. Volte em breve!"}</StateMessage>
    );
  }
  if (effectiveState === "paused" || effectiveState === "expired") {
    const fallback = STATE_MESSAGES[effectiveState];
    const message = effectiveState === "expired" ? campaign.scheduleAfterMessage || fallback : fallback;
    return <StateMessage>{message}</StateMessage>;
  }

  const mediaIds = [
    campaign.startMediaId,
    campaign.startLogoMediaId,
    campaign.finalMediaId,
    ...campaign.screens.map((s) => s.mediaId),
    ...(campaign.memoryConfig?.pairs.flatMap((p) => [p.cardAMediaId, p.cardBMediaId]) ?? []),
    campaign.memoryConfig?.cardBackMediaId,
    ...(campaign.quizConfig?.questions.flatMap((q) => [q.imageMediaId, ...q.answers.map((a) => a.imageMediaId)]) ?? []),
  ].filter((v): v is string => Boolean(v));

  const mediaAssets = mediaIds.length ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } }) : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));

  const screenBefore = campaign.screens.find((s) => s.kind === "INTERMEDIATE_BEFORE");
  const screenAfter = campaign.screens.find((s) => s.kind === "INTERMEDIATE_AFTER");

  const flowProps: PublicGameFlowProps = {
    campaignId: campaign.id,
    campaignType: campaign.type,
    isTestMode,
    start: {
      title: campaign.startTitle,
      subtitle: campaign.startSubtitle,
      introText: campaign.startIntroText,
      mediaUrl: campaign.startMediaId ? mediaById.get(campaign.startMediaId)?.url : undefined,
      logoUrl: campaign.startLogoMediaId ? mediaById.get(campaign.startLogoMediaId)?.url : undefined,
      buttonLabel: campaign.startButtonLabel,
      prizeInfo: campaign.startPrizeInfo,
    },
    regulationText: campaign.regulationText,
    leadForm: campaign.leadForm
      ? {
          position: campaign.leadForm.position,
          honeypotEnabled: campaign.leadForm.honeypotEnabled,
          fields: campaign.leadForm.fields.map((f) => ({
            id: f.id,
            internalKey: f.internalKey,
            type: f.type,
            label: f.label,
            placeholder: f.placeholder,
            helpText: f.helpText,
            required: f.required,
            options: (f.options as string[] | null) ?? null,
          })),
          consents: campaign.leadForm.consentDefinitions.map((c) => ({
            id: c.id,
            text: c.text,
            required: c.required,
          })),
        }
      : null,
    intermediateBefore: screenBefore
      ? {
          title: screenBefore.title,
          text: screenBefore.text,
          mediaUrl: screenBefore.mediaId ? mediaById.get(screenBefore.mediaId)?.url : undefined,
          ctaLabel: screenBefore.ctaLabel,
          ctaUrl: screenBefore.ctaUrl,
          continueButtonLabel: screenBefore.continueButtonLabel,
        }
      : null,
    intermediateAfter: screenAfter
      ? {
          title: screenAfter.title,
          text: screenAfter.text,
          mediaUrl: screenAfter.mediaId ? mediaById.get(screenAfter.mediaId)?.url : undefined,
          ctaLabel: screenAfter.ctaLabel,
          ctaUrl: screenAfter.ctaUrl,
          continueButtonLabel: screenAfter.continueButtonLabel,
        }
      : null,
    final: {
      title: campaign.finalTitle,
      message: campaign.finalMessage,
      mediaUrl: campaign.finalMediaId ? mediaById.get(campaign.finalMediaId)?.url : undefined,
      ctaLabel: campaign.finalCtaLabel,
      ctaUrl: campaign.finalCtaUrl,
      allowReplay: campaign.finalAllowReplay,
      allowShare: campaign.finalAllowShare,
    },
  };

  if (campaign.type === "MEMORY" && campaign.memoryConfig) {
    flowProps.memory = {
      pairs: campaign.memoryConfig.pairs.map((pair) => ({
        id: pair.id,
        cardAMediaUrl: pair.cardAMediaId ? mediaById.get(pair.cardAMediaId)?.url : undefined,
        cardAText: pair.cardAText,
        cardAAlt: pair.cardAAltText,
        cardBMediaUrl: pair.cardBMediaId ? mediaById.get(pair.cardBMediaId)?.url : undefined,
        cardBText: pair.cardBText,
        cardBAlt: pair.cardBAltText,
      })),
      config: {
        columns: campaign.memoryConfig.columns,
        randomizeOrder: campaign.memoryConfig.randomizeOrder,
        cardGapPx: campaign.memoryConfig.cardGapPx,
        timeLimitSeconds: campaign.memoryConfig.timeLimitSeconds,
        maxAttempts: campaign.memoryConfig.maxAttempts,
        previewSeconds: campaign.memoryConfig.previewSeconds,
        cardBackUrl: campaign.memoryConfig.cardBackMediaId
          ? mediaById.get(campaign.memoryConfig.cardBackMediaId)?.url
          : undefined,
      },
    };
  } else if (campaign.type === "WHEEL" && campaign.wheelConfig) {
    flowProps.wheel = {
      segments: campaign.wheelConfig.segments
        .filter((s) => s.isActive)
        .map((s) => ({ id: s.id, name: s.name, colorHex: s.colorHex })),
    };
  } else if (campaign.type === "QUIZ" && campaign.quizConfig) {
    flowProps.quiz = {
      questions: campaign.quizConfig.questions.map((question) => ({
        id: question.id,
        type: question.type,
        title: question.title,
        supportText: question.supportText,
        imageUrl: question.imageMediaId ? mediaById.get(question.imageMediaId)?.url : undefined,
        answers: question.answers.map((answer) => ({
          id: answer.id,
          text: answer.text,
          imageUrl: answer.imageMediaId ? mediaById.get(answer.imageMediaId)?.url : undefined,
        })),
      })),
      allowGoBack: campaign.quizConfig.allowGoBack,
      showProgress: campaign.quizConfig.showProgress,
      totalTimeLimitSeconds: campaign.quizConfig.totalTimeLimitSeconds,
    };
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <PublicGameFlow {...flowProps} />
    </div>
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-lg text-caetano-anthracite">{children}</p>
    </div>
  );
}
