import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { CampaignStatus } from "@/generated/prisma/client";

/*
  O ponto repete a cor do estado na cor cheia (o fundo do Badge é o tom -20):
  ajuda a ler a lista de relance. É decorativo — o estado é dito pelo texto.
*/
const DOT_CLASS: Record<(typeof CAMPAIGN_STATUS_TONE)[CampaignStatus], string> = {
  neutral: "bg-caetano-anthracite-60",
  success: "bg-caetano-eco-green",
  warning: "bg-caetano-dynamic-orange",
  info: "bg-caetano-cyan",
  danger: "bg-danger",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const tone = CAMPAIGN_STATUS_TONE[status];
  return (
    <Badge tone={tone}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} />
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}
