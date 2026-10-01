import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getPublishReadiness } from "@/features/publishing/readiness";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { publishCampaignAction, unpublishCampaignAction } from "@/features/publishing/actions";
import { prisma } from "@/server/db/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { CopyButton } from "@/components/ui/copy-button";
import { buttonVariants } from "@/components/ui/button";
import {
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Code2, Download, ExternalLink, FilePen, History, Link2, QrCode, Radio, Send, Share2 } from "lucide-react";

const EFFECTIVE_STATE_LABELS: Record<string, string> = {
  unavailable: "Não disponível publicamente",
  before_schedule: "Agendado — ainda não começou",
  paused: "Pausado — não aceita participações",
  expired: "Expirado",
  active: "Ativo e a aceitar participações",
};

function publicPlayUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/play/${slug}`;
}

// Título controlado pelo admin, interpolado num atributo HTML de um snippet
// que é copiado e colado, sem revisão, no site externo do cliente — escapar
// para não permitir "escapar" do atributo `title` (ex.: `">＜script>...`).
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function PublishStepPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const readiness = getPublishReadiness(campaign);
  const effectiveState = getEffectivePublicState(campaign);
  const isLive =
    campaign.status !== "DRAFT" &&
    campaign.status !== "IN_REVIEW" &&
    campaign.status !== "ARCHIVED";

  const versions = await prisma.campaignVersion.findMany({
    where: { campaignId: id },
    orderBy: { versionNumber: "desc" },
    take: 5,
  });

  const latestVersion = versions[0] ?? null;
  const publication = latestVersion
    ? await prisma.publication.findUnique({
        where: { campaignVersionId: latestVersion.id },
      })
    : null;
  const [qrPng, qrSvg] = publication
    ? await Promise.all([
        publication.qrPngMediaId
          ? prisma.mediaAsset.findFirst({
              where: { id: publication.qrPngMediaId, organizationId: context.organizationId },
            })
          : null,
        publication.qrSvgMediaId
          ? prisma.mediaAsset.findFirst({
              where: { id: publication.qrSvgMediaId, organizationId: context.organizationId },
            })
          : null,
      ])
    : [null, null];

  const url = publicPlayUrl(campaign.slug);
  const canPublish = can(context, "campaign:publish");
  // Nunca o nome interno: o snippet vai para o site de terceiros.
  const embedTitle = escapeHtmlAttribute(campaign.publicTitle || campaign.startTitle || "Campanha");
  const embedSnippet = `<iframe src="${url}?embed=1" width="100%" height="${publication?.embedHeightPx ?? 720}" style="border:0" title="${embedTitle}"></iframe>`;

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Publicação"
        description="Publique a campanha para gerar o link público, QR code e código de incorporação."
      />

      <section aria-label="Estado da publicação" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              isLive
                ? "bg-caetano-eco-green-20 text-caetano-deep-blue ring-1 ring-caetano-eco-green-40"
                : "bg-caetano-medium-gray-20 text-caetano-deep-blue",
            )}
          >
            {isLive ? <Radio size={20} /> : <FilePen size={20} />}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-caetano-anthracite-80">Estado:</span>
            <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
              {CAMPAIGN_STATUS_LABELS[campaign.status]}
            </Badge>
            {isLive && (
              <span className="text-sm text-caetano-anthracite-80">
                — {EFFECTIVE_STATE_LABELS[effectiveState]}
              </span>
            )}
          </div>
        </div>

        {search.error === "readiness" && (
          <Alert variant="error">
            A campanha ainda não está pronta para ser publicada. Corrija os pontos abaixo e tente
            novamente.
          </Alert>
        )}

        {!readiness.ready && (
          <Alert variant="info">
            <p className="font-medium">Antes de publicar, resolva:</p>
            <ul className="mt-1 list-disc pl-5">
              {readiness.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </Alert>
        )}

        {!canPublish && (
          <p className="rounded-lg bg-caetano-medium-gray-20 px-3 py-2 text-sm text-caetano-anthracite-80">
            Publicar e despublicar exige permissão de publicação. Peça a um administrador da
            organização.
          </p>
        )}

        {canPublish && (
          <div className="flex flex-col gap-2 border-t border-caetano-medium-gray-40 pt-4 sm:flex-row sm:flex-wrap">
            <form action={publishCampaignAction}>
              <input type="hidden" name="campaignId" value={campaign.id} />
              {/* Publicar cria uma CampaignVersion imutável: dois cliques seguidos
                geravam duas versões. O SubmitButton desativa-se enquanto a ação
                corre. */}
              <SubmitButton
                disabled={!readiness.ready}
                pendingLabel="A publicar…"
                size="lg"
                // Altura mínima e não fixa: num ecrã estreito o texto muda de linha sem sair do botão.
                className="h-auto min-h-12 w-full py-2.5 text-center sm:w-auto"
              >
                <Send size={18} aria-hidden="true" />
                {isLive ? "Republicar (nova versão)" : "Publicar"}
              </SubmitButton>
            </form>
            {isLive && (
              <form action={unpublishCampaignAction}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <ConfirmSubmitButton
                  confirmMessage="Despublicar a campanha? O link público deixa de aceitar participações e a campanha volta a rascunho."
                  variant="outline"
                  size="lg"
                  className="h-auto min-h-12 w-full py-2.5 text-center sm:w-auto"
                >
                  Despublicar (voltar a rascunho)
                </ConfirmSubmitButton>
              </form>
            )}
          </div>
        )}
      </section>

      {isLive && (
        <>
          <section aria-labelledby="publish-link-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
            <ChannelHeading id="publish-link-heading" icon={<Link2 size={18} />} title="Link direto" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <code className="flex min-h-10 min-w-0 flex-1 items-center rounded-lg border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-3 py-2 font-mono text-sm break-all text-caetano-deep-blue">
                {url}
              </code>
              <div className="flex shrink-0 flex-wrap gap-2">
                <CopyButton value={url} size="md" />
                <a
                  href={`${url}?test=1`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "ghost", className: "text-caetano-deep-blue underline-offset-4 hover:underline" })}
                >
                  Testar versão publicada
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-caetano-anthracite-80">
              O modo de teste (só visível para quem tem acesso de edição a esta campanha) regista
              participações marcadas como teste — não conta para estatísticas nem consome stock de
              prémios.
            </p>
          </section>

          <section aria-labelledby="publish-qr-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
            <ChannelHeading id="publish-qr-heading" icon={<QrCode size={18} />} title="QR Code" />
            {qrPng && qrSvg ? (
              <div className="flex flex-wrap items-center gap-5 sm:gap-6">
                <div className="rounded-2xl border border-caetano-medium-gray-40 bg-white p-3 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrPng.url} alt="QR Code" className="h-32 w-32 sm:h-36 sm:w-36" />
                </div>
                <div className="flex flex-col gap-2 min-[420px]:flex-row sm:flex-col">
                  <a href={qrPng.url} download className={buttonVariants({ variant: "outline" })}>
                    <Download size={16} aria-hidden="true" />
                    Descarregar PNG
                  </a>
                  <a href={qrSvg.url} download className={buttonVariants({ variant: "outline" })}>
                    <Download size={16} aria-hidden="true" />
                    Descarregar SVG
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-sm text-caetano-anthracite-80">QR Code não disponível.</p>
            )}
          </section>

          <section aria-labelledby="publish-embed-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
            <ChannelHeading id="publish-embed-heading" icon={<Code2 size={18} />} title="Embed (iframe)" />
            <textarea
              readOnly
              rows={3}
              aria-label="Código de incorporação"
              value={embedSnippet}
              className={cn(TEXTAREA_CLASS, "resize-none bg-caetano-medium-gray-20 font-mono text-xs text-caetano-deep-blue")}
            />
            <CopyButton value={embedSnippet} label="Copiar código de incorporação" size="md" />
            <p className="text-xs leading-relaxed text-caetano-anthracite-80">
              Num site com outro domínio, o limite por cookie conta cada site que incorpora separadamente (o
              browser isola o cookie por site). Para limitar a uma participação por pessoa, ative também o
              controlo de duplicados por e-mail ou telefone. Se o site aplicar <code className="font-mono">sandbox</code> ao iframe,
              tem de permitir <code className="font-mono">allow-scripts allow-same-origin allow-forms</code>.
            </p>
          </section>

          <section aria-labelledby="publish-share-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
            <ChannelHeading id="publish-share-heading" icon={<Share2 size={18} />} title="Partilha" />
            <p className="text-xs leading-relaxed text-caetano-anthracite-80">
              Adicione parâmetros UTM ao link antes de o partilhar em campanhas de marketing.
            </p>
            <div className="grid grid-cols-1 gap-2 text-sm min-[420px]:grid-cols-2 lg:grid-cols-4">
              <code className="truncate rounded-lg border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-2.5 py-1.5 font-mono text-caetano-deep-blue">?utm_source=…</code>
              <code className="truncate rounded-lg border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-2.5 py-1.5 font-mono text-caetano-deep-blue">&utm_medium=…</code>
              <code className="truncate rounded-lg border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-2.5 py-1.5 font-mono text-caetano-deep-blue">&utm_campaign=…</code>
              <code className="truncate rounded-lg border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-2.5 py-1.5 font-mono text-caetano-deep-blue">&utm_content=…</code>
            </div>
          </section>

          <section aria-labelledby="publish-versions-heading" className={cn(STEP_CARD_CLASS, "space-y-3")}>
            <ChannelHeading id="publish-versions-heading" icon={<History size={18} />} title="Versões publicadas" />
            <ul className="divide-y divide-caetano-medium-gray-20 text-sm">
              {versions.map((version, index) => (
                <li key={version.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2 font-medium text-caetano-anthracite">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        index === 0 ? "bg-caetano-cyan ring-4 ring-caetano-cyan-20" : "bg-caetano-medium-gray-60",
                      )}
                    />
                    Versão {version.versionNumber}
                  </span>
                  <span className="tabular-nums text-caetano-anthracite-80">
                    {version.createdAt.toLocaleString("pt-PT")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** Título de um canal de publicação (link, QR code, embed...), com o ícone dele. */
function ChannelHeading({ id, icon, title }: { id: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-caetano-cyan-20 text-caetano-deep-blue"
      >
        {icon}
      </span>
      <h3 id={id} className="text-base font-bold text-caetano-deep-blue">
        {title}
      </h3>
    </div>
  );
}
