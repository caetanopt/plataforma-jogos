import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CampaignRowActions } from "@/components/backoffice/campaign-row-actions";
import { CampaignStatusBadge } from "@/components/backoffice/home-apps/campaign-status-badge";
import { GameTypeArtwork } from "@/components/backoffice/home-apps/game-type-art";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";
import type { CampaignStatus, CampaignType } from "@/generated/prisma/client";

export interface CampaignCardData {
  id: string;
  internalName: string;
  type: CampaignType;
  status: CampaignStatus;
  updatedAt: Date;
  folder: { name: string } | null;
  owner: { name: string };
  _count: { participations: number };
}

export interface CampaignPermissions {
  canEdit: boolean;
  canViewLeads: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
}

/**
 * Destino do nome da aplicação: o editor para quem pode editar; para os
 * outros perfis, as estatísticas (que todos podem consultar) — um link para o
 * editor acabava em "Sem permissão".
 */
export function campaignPrimaryHref(campaignId: string, canEdit: boolean): string {
  return canEdit ? `/apps/${campaignId}/informacoes` : `/analytics?campaignId=${campaignId}`;
}

/** Cartão da vista em grelha de Aplicações. */
export function CampaignCard({
  campaign,
  permissions,
}: {
  campaign: CampaignCardData;
  permissions: CampaignPermissions;
}) {
  const participations = campaign._count.participations;

  return (
    <Card
      as="article"
      interactive
      padding="none"
      // O menu aberto passa por cima dos cartões seguintes (que, ao passar o
      // rato, ganham um contexto de empilhamento próprio pelo translate).
      className="group/type relative flex h-full flex-col focus-within:border-caetano-medium-gray-60 focus-within:shadow-md has-[details[open]]:z-30"
    >
      <GameTypeArtwork
        type={campaign.type}
        compactOnMobile
        className="h-26 rounded-t-2xl border-b border-caetano-medium-gray-40 sm:h-32"
      />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 pt-1">
            <h2 className="truncate text-base font-bold leading-snug text-caetano-deep-blue">
              {/*
                O link cobre o cartão inteiro (área clicável generosa), mas
                fica por baixo do menu de ações. O anel de foco é desenhado
                pelo pseudo-elemento, à volta do cartão.
              */}
              <Link
                href={campaignPrimaryHref(campaign.id, permissions.canEdit)}
                className="outline-none before:absolute before:inset-0 before:rounded-2xl focus-visible:before:ring-2 focus-visible:before:ring-caetano-cyan focus-visible:before:ring-offset-2"
              >
                {campaign.internalName}
              </Link>
            </h2>
            <p className="mt-0.5 truncate text-sm text-caetano-anthracite-80">
              {CAMPAIGN_TYPE_LABELS[campaign.type]} · {campaign.folder?.name ?? "Sem pasta"}
            </p>
          </div>
          <div className="relative z-10 -mr-2 -mt-1 shrink-0">
            <CampaignRowActions campaignId={campaign.id} status={campaign.status} {...permissions} />
          </div>
        </div>

        <p className="mt-3 flex min-w-0 items-center gap-1.5 text-xs text-caetano-anthracite-80">
          <Clock size={13} aria-hidden="true" className="shrink-0" />
          <span className="truncate">
            {campaign.updatedAt.toLocaleDateString("pt-PT")} · {campaign.owner.name}
          </span>
        </p>

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <CampaignStatusBadge status={campaign.status} />
          <span className="inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80 tabular-nums">
            <Users size={13} aria-hidden="true" />
            {participations} participações
          </span>
        </div>
      </div>
    </Card>
  );
}
