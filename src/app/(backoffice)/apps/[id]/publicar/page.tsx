import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getPublishReadiness } from "@/features/publishing/readiness";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { publishCampaignAction, unpublishCampaignAction } from "@/features/publishing/actions";
import { prisma } from "@/server/db/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { CopyButton } from "@/components/ui/copy-button";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/lib/labels";

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
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const readiness = getPublishReadiness(campaign);
  const effectiveState = getEffectivePublicState(campaign);
  const isLive = campaign.status !== "DRAFT" && campaign.status !== "IN_REVIEW" && campaign.status !== "ARCHIVED";

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
        publication.qrPngMediaId ? prisma.mediaAsset.findUnique({ where: { id: publication.qrPngMediaId } }) : null,
        publication.qrSvgMediaId ? prisma.mediaAsset.findUnique({ where: { id: publication.qrSvgMediaId } }) : null,
      ])
    : [null, null];

  const url = publicPlayUrl(campaign.slug);
  const embedTitle = escapeHtmlAttribute(campaign.publicTitle ?? campaign.internalName);
  const embedSnippet = `<iframe src="${url}?embed=1" width="100%" height="${publication?.embedHeightPx ?? 720}" style="border:0" title="${embedTitle}"></iframe>`;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Publicação</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Publique a campanha para gerar o link público, QR code e código de incorporação.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <span className="text-sm text-caetano-medium-gray">Estado:</span>
        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
        {isLive && (
          <span className="text-sm text-caetano-medium-gray">
            — {EFFECTIVE_STATE_LABELS[effectiveState]}
          </span>
        )}
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

      <div className="flex flex-wrap gap-2">
        <form action={publishCampaignAction}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <Button type="submit" disabled={!readiness.ready}>
            {isLive ? "Republicar (nova versão)" : "Publicar"}
          </Button>
        </form>
        {isLive && (
          <form action={unpublishCampaignAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <ConfirmSubmitButton
              confirmMessage="Despublicar a campanha? O link público deixa de aceitar participações e a campanha volta a rascunho."
              variant="outline"
            >
              Despublicar (voltar a rascunho)
            </ConfirmSubmitButton>
          </form>
        )}
      </div>

      {isLive && (
        <>
          <section className="space-y-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h3 className="text-sm font-semibold text-caetano-anthracite">Link direto</h3>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 rounded-lg bg-neutral-100 px-3 py-2 text-sm break-all">{url}</code>
              <CopyButton value={url} />
              <a
                href={`${url}?test=1`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-caetano-cyan underline"
              >
                Testar versão publicada
              </a>
            </div>
            <p className="text-xs text-caetano-medium-gray">
              O modo de teste (só visível para quem tem acesso de edição a esta campanha) regista
              participações marcadas como teste — não conta para estatísticas nem consome stock de
              prémios.
            </p>
          </section>

          <section className="space-y-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h3 className="text-sm font-semibold text-caetano-anthracite">QR Code</h3>
            {qrPng && qrSvg ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrPng.url} alt="QR Code" className="h-32 w-32 rounded-lg border border-caetano-medium-gray/30" />
                <div className="flex flex-col gap-2">
                  <a href={qrPng.url} download className="text-sm text-caetano-cyan underline">
                    Descarregar PNG
                  </a>
                  <a href={qrSvg.url} download className="text-sm text-caetano-cyan underline">
                    Descarregar SVG
                  </a>
                </div>
              </div>
            ) : (
              <p className="text-sm text-caetano-medium-gray">QR Code não disponível.</p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h3 className="text-sm font-semibold text-caetano-anthracite">Embed (iframe)</h3>
            <textarea
              readOnly
              rows={3}
              value={embedSnippet}
              className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 font-mono text-xs"
            />
            <CopyButton value={embedSnippet} label="Copiar código de incorporação" />
          </section>

          <section className="space-y-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h3 className="text-sm font-semibold text-caetano-anthracite">Partilha</h3>
            <p className="text-xs text-caetano-medium-gray">
              Adicione parâmetros UTM ao link antes de o partilhar em campanhas de marketing.
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <code className="rounded bg-neutral-100 px-2 py-1">?utm_source=…</code>
              <code className="rounded bg-neutral-100 px-2 py-1">&utm_medium=…</code>
              <code className="rounded bg-neutral-100 px-2 py-1">&utm_campaign=…</code>
              <code className="rounded bg-neutral-100 px-2 py-1">&utm_content=…</code>
            </div>
          </section>

          <section className="space-y-2 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h3 className="text-sm font-semibold text-caetano-anthracite">Versões publicadas</h3>
            <ul className="divide-y divide-caetano-medium-gray/20 text-sm">
              {versions.map((version) => (
                <li key={version.id} className="flex items-center justify-between py-2">
                  <span>Versão {version.versionNumber}</span>
                  <span className="text-caetano-medium-gray">
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
