import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getIncompleteSteps } from "@/features/campaigns/step-completion";
import { EditorNav } from "@/components/backoffice/editor/editor-nav";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, CAMPAIGN_TYPE_LABELS } from "@/lib/labels";

export default async function CampaignEditorLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const incompleteSteps = Array.from(getIncompleteSteps(campaign));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-caetano-medium-gray/30 bg-white px-6 py-4">
        <div>
          <Link href="/apps" className="text-sm text-caetano-cyan hover:underline">
            ← Aplicações
          </Link>
          <h1 className="text-lg font-semibold text-caetano-anthracite">{campaign.internalName}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{CAMPAIGN_TYPE_LABELS[campaign.type]}</Badge>
          <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
            {CAMPAIGN_STATUS_LABELS[campaign.status]}
          </Badge>
        </div>
      </div>
      <div className="flex flex-1 flex-col md:flex-row">
        <EditorNav campaignId={campaign.id} incompleteSteps={incompleteSteps} />
        <div className="flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
