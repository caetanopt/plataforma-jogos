import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { canTestCampaign } from "@/features/play/test-mode";
import { PublicGameFlow, type PublicGameFlowProps } from "@/components/public-game/public-game-flow";
import { GameThemeShell } from "@/components/public-game/game-theme-shell";
import { publicLegalLinks } from "@/features/brand/legal-links";

const STATE_MESSAGES: Record<string, string> = {
  paused: "Esta campanha está temporariamente pausada. Volte mais tarde.",
  expired: "Esta campanha já terminou. Obrigado pelo interesse!",
};

/**
 * A campanha da página pública, lida uma vez por pedido: os metadados e a
 * página usam a mesma leitura (antes eram duas, a página mais visitada).
 */
const loadPublicCampaign = cache((slug: string) =>
  prisma.campaign.findUnique({
    where: { slug },
    include: {
      theme: true,
      organization: { select: { name: true, privacyContactEmail: true } },
      // Um ecrã desligado no editor guarda o conteúdo, mas não se mostra.
      screens: { where: { enabled: true } },
      memoryConfig: { include: { pairs: { orderBy: { order: "asc" } } } },
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      quizConfig: {
        include: {
          questions: { include: { answers: { orderBy: { order: "asc" } } }, orderBy: { order: "asc" } },
          resultProfiles: { orderBy: { minPercentage: "asc" } },
        },
      },
    },
  }),
);

/**
 * Sem isto, a campanha era partilhada com o título do backoffice
 * ("Plataforma de Jogos | Caetano") em vez do seu próprio nome.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await loadPublicCampaign(slug);

  // Rascunhos, campanhas em validação e arquivadas não existem para o
  // público — os metadados também não os podem revelar.
  const noIndex = { index: false, follow: false };
  if (!campaign || getEffectivePublicState(campaign) === "unavailable") {
    return { title: "Campanha não encontrada", robots: noIndex };
  }

  // Nunca o nome interno: é do backoffice (ex.: "Roda — teste cliente X").
  const title = campaign.publicTitle || campaign.startTitle || "Campanha";
  // O favicon do tema (Marca e design), só da própria organização.
  const favicon = campaign.theme?.faviconMediaId
    ? await prisma.mediaAsset.findFirst({
        where: { id: campaign.theme.faviconMediaId, organizationId: campaign.organizationId },
        select: { url: true },
      })
    : null;
  return {
    title,
    description: campaign.startIntroText ?? undefined,
    robots: campaign.status === "PUBLISHED" ? undefined : noIndex,
    openGraph: { title, description: campaign.startIntroText ?? undefined },
    icons: favicon ? { icon: favicon.url, shortcut: favicon.url } : undefined,
  };
}

export default async function PublicPlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ test?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;

  const campaign = await loadPublicCampaign(slug);
  if (!campaign) notFound();

  const effectiveState = getEffectivePublicState(campaign);
  if (effectiveState === "unavailable") notFound();

  const isTestMode = search.test === "1" && (await canTestCampaign(campaign.organizationId));

  const theme = campaign.theme;
  const mediaIds = [
    theme?.logoMediaId,
    theme?.backgroundImageMediaId,
    campaign.startMediaId,
    campaign.startLogoMediaId,
    campaign.finalMediaId,
    ...campaign.screens.map((s) => s.mediaId),
    ...(campaign.memoryConfig?.pairs.flatMap((p) => [p.cardAMediaId, p.cardBMediaId]) ?? []),
    campaign.memoryConfig?.cardBackMediaId,
    ...(campaign.quizConfig?.questions.flatMap((q) => [q.imageMediaId, ...q.answers.map((a) => a.imageMediaId)]) ?? []),
  ].filter((v): v is string => Boolean(v));

  const mediaAssets = mediaIds.length ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, organizationId: campaign.organizationId } }) : [];
  const mediaById = new Map(mediaAssets.map((m) => [m.id, m]));

  // O tema da campanha (Marca e design): cores, tipografia, fundo e logótipo.
  const brandLogo = theme?.logoMediaId ? mediaById.get(theme.logoMediaId) : undefined;
  // O texto alternativo do tema (Marca e design), copiado com o resto: nunca o
  // nome do brand kit, que é um rótulo do backoffice e, lido aqui, mudava as
  // campanhas já publicadas quando o kit era renomeado (§10). Sem texto, o
  // nome da organização: "Logótipo" não diz de quem é.
  const brandLogoAlt = theme?.logoAltText?.trim() || campaign.organization.name;
  // O jogo marca o seu próprio <main>, para o rodapé legal ficar fora dele
  // (PublicGameFlow, `landmarks`); as mensagens de estado vão num <main> aqui.
  const shell = (children: React.ReactNode, { main = true }: { main?: boolean } = {}) => (
    <GameThemeShell
      theme={theme}
      backgroundImageUrl={theme?.backgroundImageMediaId ? mediaById.get(theme.backgroundImageMediaId)?.url : undefined}
      className="flex min-h-dvh flex-1 flex-col"
    >
      {isTestMode && (
        // O CLAUDE.md §18 exige aviso visual PERMANENTE: fixo no topo ao fazer
        // scroll, e antes do cabeçalho para não tapar o logótipo.
        <div
          role="status"
          className="sticky top-0 z-50 border-b border-caetano-dynamic-orange bg-caetano-dynamic-orange-20 px-4 py-2 text-center text-sm font-medium text-caetano-anthracite"
        >
          Modo de teste — esta participação não conta para estatísticas nem consome stock.
        </div>
      )}
      {brandLogo && (
        <header className="flex justify-center px-4 pt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={brandLogo.url}
            alt={brandLogoAlt}
            className="h-10 max-w-[60%] object-contain"
          />
        </header>
      )}
      {main ? <main className="flex flex-1 flex-col">{children}</main> : children}
    </GameThemeShell>
  );

  if (effectiveState === "before_schedule") {
    return shell(
      <StateMessage>{campaign.scheduleBeforeMessage || "Esta campanha ainda não começou. Volte em breve!"}</StateMessage>,
    );
  }
  if (effectiveState === "paused" || effectiveState === "expired") {
    const fallback = STATE_MESSAGES[effectiveState];
    const message = effectiveState === "expired" ? campaign.scheduleAfterMessage || fallback : fallback;
    return shell(<StateMessage>{message}</StateMessage>);
  }

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
      // O logótipo do tema já está no cabeçalho: não se repete no ecrã inicial.
      logoUrl:
        campaign.startLogoMediaId && campaign.startLogoMediaId !== theme?.logoMediaId
          ? mediaById.get(campaign.startLogoMediaId)?.url
          : undefined,
      buttonLabel: campaign.startButtonLabel,
      prizeInfo: campaign.startPrizeInfo,
    },
    regulationText: campaign.regulationText,
    legal: {
      legalText: campaign.legalText,
      links: publicLegalLinks(theme?.legalLinks),
      privacyContactEmail: campaign.organization.privacyContactEmail,
    },
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

  return shell(
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <PublicGameFlow {...flowProps} landmarks />
    </div>,
    { main: false },
  );
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="rounded-game-lg bg-game-surface px-6 py-4 text-lg text-game-text">{children}</p>
    </div>
  );
}
