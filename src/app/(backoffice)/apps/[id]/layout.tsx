import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Brain, Disc3, ListChecks, type LucideIcon } from "lucide-react";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { getIncompleteSteps } from "@/features/campaigns/step-completion";
import { EditorNav } from "@/components/backoffice/editor/editor-nav";
import { EditorHeaderActions, EditorStepLabel } from "@/components/backoffice/editor/editor-chrome";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE, CAMPAIGN_TYPE_LABELS } from "@/lib/labels";
import type { CampaignType } from "@/generated/prisma/client";

/** O mesmo ícone de cada tipo de jogo da lista de Aplicações. */
const TYPE_ICONS: Record<CampaignType, LucideIcon> = {
  MEMORY: Brain,
  WHEEL: Disc3,
  QUIZ: ListChecks,
};

export default async function CampaignEditorLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const incompleteSteps = Array.from(getIncompleteSteps(campaign));
  const TypeIcon = TYPE_ICONS[campaign.type];

  return (
    <div className="p-4 sm:p-6 md:p-8">
      {/*
        Cabeçalho do editor na superfície de marca: o azul profundo com a luz
        do azul cyan, como as aplicações digitais do Brand Book. É o único
        destaque da página — as etapas ficam no branco. A luz fica à direita,
        longe do nome, para o contraste do branco não depender dela.
      */}
      <header className="surface-brand relative isolate overflow-hidden rounded-2xl px-5 py-5 shadow-lg sm:rounded-3xl sm:px-7 sm:py-6 lg:px-8">
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute inset-y-0 right-0 hidden w-1/2 sm:block">
            <div className="brand-aurora" />
          </div>
          <span className="brand-streak top-[90%]" />
        </div>

        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <Link
              href="/apps"
              className="group -mx-1 inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-caetano-cyan-20 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ArrowLeft
                size={16}
                aria-hidden="true"
                className="transition-transform duration-200 ease-(--ease-out-expo) motion-safe:group-hover:-translate-x-0.5"
              />
              Aplicações
            </Link>
            <h1 className="mt-1.5 break-words text-[1.375rem] font-bold leading-tight tracking-tight text-white sm:text-[1.75rem]">
              {campaign.internalName}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-caetano-deep-blue-80 px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-caetano-deep-blue-60">
                <TypeIcon size={13} aria-hidden="true" />
                {CAMPAIGN_TYPE_LABELS[campaign.type]}
              </span>
              <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
            </div>
          </div>
          <EditorHeaderActions campaignId={campaign.id} canPublish={can(context, "campaign:publish")} />
        </div>
      </header>

      {/* Duas colunas só quando sobra espaço ao lado da barra lateral (que
          aparece a partir de md): antes disso, as etapas são uma faixa no topo. */}
      <div className="mt-5 sm:mt-6 md:mt-8 xl:grid xl:grid-cols-[16.5rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <EditorNav campaignId={campaign.id} incompleteSteps={incompleteSteps} />
        <div className="mt-6 min-w-0 xl:mt-0">
          <EditorStepLabel campaignId={campaign.id} />
          {children}
        </div>
      </div>
    </div>
  );
}
