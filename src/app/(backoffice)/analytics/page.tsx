import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Brain,
  CalendarClock,
  CalendarRange,
  CircleCheckBig,
  Compass,
  Cpu,
  Disc3,
  Eye,
  Globe,
  Info,
  ListChecks,
  MonitorSmartphone,
  MousePointerClick,
  PackageMinus,
  Percent,
  ShieldBan,
  SlidersHorizontal,
  Smartphone,
  Timer,
  Trophy,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { resolveDateRange, type DateRange, type PeriodPreset } from "@/lib/dates/range";
import { getCampaignStats, type CampaignStatsFilters } from "@/features/analytics/campaign-stats";
import { getCampaignAlerts } from "@/features/analytics/campaign-alerts";
import { StatCard } from "@/components/backoffice/stat-card";
import { BarList, type BarListItem } from "@/components/backoffice/analytics/bar-list";
import { FilterSelect } from "@/components/backoffice/analytics/filter-select";
import { MetricTile } from "@/components/backoffice/analytics/metric-tile";
import { ParticipationTimelineChart } from "@/components/charts/participation-timeline-chart-lazy";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Estatísticas" };

interface AnalyticsSearchParams {
  campaignId?: string;
  period?: string;
  from?: string;
  to?: string;
  type?: string;
  workspaceId?: string;
  folderId?: string;
}

/** Máximo de alertas visíveis por tipo antes de resumir o resto. */
const MAX_ALERTS_PER_KIND = 5;

/** Mesmo limiar dos alertas de stock (§20): até 5 restantes exige atenção. */
const LOW_STOCK_THRESHOLD = 5;

const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "90d", label: "Últimos 90 dias" },
  { value: "all", label: "Todo o período" },
  { value: "custom", label: "Personalizado" },
];

/** Título de secção (h2) do backoffice. */
const sectionHeadingClass = "text-base font-bold text-caetano-deep-blue sm:text-lg";
/** Subtítulo dentro de um cartão (h3). */
const subHeadingClass = "flex items-center gap-2 text-sm font-bold text-caetano-deep-blue";
/** Ligação dentro de texto corrido, com o anel de foco do azul cyan. */
const inlineLinkClass =
  "rounded-sm font-bold break-words text-caetano-deep-blue underline decoration-caetano-cyan-40 decoration-2 underline-offset-2 transition-colors duration-200 hover:decoration-caetano-deep-blue focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:outline-none";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("stats:view");
  // As ligações dos alertas levam ao editor: só para quem o pode abrir.
  const canEditCampaigns = can(context, "campaign:edit");
  const range = resolveDateRange(params);

  const type =
    params.type === "MEMORY" || params.type === "WHEEL" || params.type === "QUIZ" ? params.type : undefined;

  const filters: CampaignStatsFilters = {
    campaignId: params.campaignId || undefined,
    workspaceId: params.workspaceId || undefined,
    folderId: params.folderId || undefined,
    type,
  };

  const [campaigns, workspaces, folders, stats, alerts] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, internalName: true, type: true },
      orderBy: { internalName: "asc" },
    }),
    prisma.workspace.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.folder.findMany({
      where: {
        workspace: { organizationId: context.organizationId },
        archivedAt: null,
        ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Nomes reais no ranking só para quem pode ver leads (§3): o Visualizador
    // e o Editor veem "Anónimo".
    getCampaignStats(context.organizationId, range, filters, {
      showParticipantNames: can(context, "leads:view"),
    }),
    // Os alertas ignoram deliberadamente o intervalo de datas: ver
    // campaign-alerts.ts.
    getCampaignAlerts(context.organizationId, filters),
  ]);

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const hasAlerts = alerts.endingSoon.length > 0 || alerts.stockAlerts.length > 0;
  const totalAlerts = alerts.endingSoon.length + alerts.stockAlerts.length;
  // Uma parede de alertas deixa de ser um alerta. Mostram-se os mais urgentes
  // (já vêm ordenados) e conta-se o resto.
  const visibleEndingSoon = alerts.endingSoon.slice(0, MAX_ALERTS_PER_KIND);
  const visibleStockAlerts = alerts.stockAlerts.slice(0, MAX_ALERTS_PER_KIND);
  const hiddenAlerts =
    alerts.endingSoon.length -
    visibleEndingSoon.length +
    (alerts.stockAlerts.length - visibleStockAlerts.length);

  const portfolio: Array<{ label: string; value: number; dot: string }> = [
    { label: "Publicados", value: alerts.published, dot: "bg-caetano-eco-green" },
    { label: "Rascunhos", value: alerts.drafts, dot: "bg-caetano-medium-gray-60" },
    { label: "Agendados", value: alerts.scheduled, dot: "bg-caetano-sky" },
    { label: "Pausados", value: alerts.paused, dot: "bg-caetano-dynamic-orange" },
  ];

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Estatísticas"
        description="Métricas de visualizações, participações e conversão das suas campanhas."
      />

      <div className="space-y-6 sm:space-y-8">
        {/* Uma barra de filtros só, por cima de tudo o que ela filtra. */}
        <Card as="form" method="get" aria-labelledby="filters-heading">
          <p
            id="filters-heading"
            className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-caetano-deep-blue-80"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filtros
          </p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4 lg:grid-cols-4">
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="campaignId">Campanha</Label>
              <FilterSelect id="campaignId" name="campaignId" defaultValue={params.campaignId ?? ""}>
                <option value="">Todas</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.internalName}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="workspaceId">Espaço de trabalho</Label>
              <FilterSelect id="workspaceId" name="workspaceId" defaultValue={params.workspaceId ?? ""}>
                <option value="">Todos</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="folderId">Pasta / marca</Label>
              <FilterSelect id="folderId" name="folderId" defaultValue={params.folderId ?? ""}>
                <option value="">Todas</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="type">Tipo de jogo</Label>
              <FilterSelect id="type" name="type" defaultValue={params.type ?? ""}>
                <option value="">Todos</option>
                {Object.entries(CAMPAIGN_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="period">Período</Label>
              <FilterSelect id="period" name="period" defaultValue={range.preset}>
                {PERIOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </FilterSelect>
            </div>
            <div>
              <Label htmlFor="from">De</Label>
              <Input id="from" type="date" name="from" defaultValue={params.from} />
            </div>
            <div>
              <Label htmlFor="to">Até</Label>
              <Input id="to" type="date" name="to" defaultValue={params.to} />
            </div>
            <div className="col-span-2 flex items-end sm:col-span-1">
              <Button type="submit" variant="primary" className="w-full">
                Aplicar filtros
              </Button>
            </div>
          </div>
        </Card>

        {/* O retrato de agora: não depende do período (§20). */}
        <div className={cn("grid gap-4 sm:gap-6", hasAlerts && "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
          <section
            aria-labelledby="portfolio-heading"
            className="surface-brand @container relative isolate flex flex-col overflow-hidden rounded-2xl p-5 shadow-md sm:p-6"
          >
            <div aria-hidden="true" className="absolute inset-0 -z-10">
              <div className="brand-aurora" />
              {/* Rente à base, por baixo dos números: a luz passa sem riscar o texto. */}
              <span className="brand-streak bottom-2.5" />
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="portfolio-heading" className="text-base font-bold text-white sm:text-lg">
                  Estado das campanhas
                </h2>
                <p className="mt-1 text-sm text-white">Retrato atual — não depende do período selecionado.</p>
              </div>
              <Link href="/apps" className={buttonVariants({ variant: "inverse", className: "shrink-0" })}>
                Ver aplicações
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
            <dl
              // Quatro colunas só quando o próprio cartão tem largura para
              // elas (ao lado dos alertas, ou com a barra lateral aberta num
              // ecrã médio, fica 2 × 2).
              className="stagger mt-6 grid grid-cols-2 gap-x-4 gap-y-5 @2xl:grid-cols-4 lg:mt-auto lg:pt-6"
            >
              {portfolio.map((item) => (
                <div key={item.label} className="border-l border-caetano-deep-blue-60 pl-4">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-white">
                    <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", item.dot)} />
                    {item.label}
                  </dt>
                  <dd className="mt-1 text-4xl font-light tracking-tight text-white">{item.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {hasAlerts && (
            <section aria-labelledby="alerts-heading">
              <Card padding="none" className="flex h-full flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-caetano-medium-gray-40 px-4 py-3.5 sm:px-5">
                  <div className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-caetano-dynamic-orange-20 text-caetano-anthracite ring-1 ring-caetano-dynamic-orange-40"
                    >
                      <BellRing size={16} />
                    </span>
                    <h2 id="alerts-heading" className={sectionHeadingClass}>
                      Alertas
                    </h2>
                  </div>
                  <Badge tone="warning">
                    {totalAlerts}
                    <span className="sr-only">{totalAlerts === 1 ? " alerta" : " alertas"}</span>
                  </Badge>
                </div>
                <ul className="divide-y divide-caetano-medium-gray-20">
                  {visibleEndingSoon.map((campaign) => (
                    <li key={campaign.id} className="flex items-start gap-3 px-4 py-3 text-sm text-caetano-anthracite sm:px-5">
                      <AlertIcon icon={CalendarClock} tone="ending" />
                      <span className="min-w-0 pt-1">
                        A campanha{" "}
                        {canEditCampaigns ? (
                          <Link href={`/apps/${campaign.id}/agenda`} className={inlineLinkClass}>
                            {campaign.internalName}
                          </Link>
                        ) : (
                          <span className="font-bold break-words">{campaign.internalName}</span>
                        )}{" "}
                        {campaign.scheduleEndAt ? (
                          <>
                            termina a{" "}
                            <time dateTime={campaign.scheduleEndAt.toISOString()} className="font-medium tabular-nums">
                              {formatEndDate(campaign.scheduleEndAt)}
                            </time>
                            .
                          </>
                        ) : (
                          "termina brevemente."
                        )}
                      </span>
                    </li>
                  ))}
                  {visibleStockAlerts.map((prize) => (
                    <li key={prize.id} className="flex items-start gap-3 px-4 py-3 text-sm text-caetano-anthracite sm:px-5">
                      <AlertIcon icon={PackageMinus} tone="stock" />
                      <span className="min-w-0 pt-1">
                        Stock baixo no prémio{" "}
                        {canEditCampaigns ? (
                          <Link href={`/apps/${prize.campaignId}/jogo`} className={inlineLinkClass}>
                            {prize.publicName}
                          </Link>
                        ) : (
                          <span className="font-bold break-words">{prize.publicName}</span>
                        )}{" "}
                        ({prize.remaining === 1 ? "1 restante" : `${prize.remaining} restantes`}
                        {prize.reserved > 0 && `, ${prize.reserved} ${prize.reserved === 1 ? "reservado" : "reservados"}`}).
                      </span>
                    </li>
                  ))}
                </ul>
                {hiddenAlerts > 0 && (
                  <p className="mt-auto border-t border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-4 py-3 text-xs text-caetano-anthracite-80 sm:px-5">
                    {hiddenAlerts === 1 ? "Mais 1 alerta" : `Mais ${hiddenAlerts} alertas`} — filtre por
                    campanha, espaço de trabalho ou pasta para os ver.
                  </p>
                )}
              </Card>
            </section>
          )}
        </div>

        <section aria-labelledby="performance-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
            <h2 id="performance-heading" className={sectionHeadingClass}>
              Desempenho no período
            </h2>
            <Badge tone="info">
              <CalendarRange size={12} aria-hidden="true" />
              {periodLabel(range)}
            </Badge>
          </div>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
            <StatCard
              label="Visualizações"
              value={stats.general.views}
              hint={`${stats.general.uniqueViews} únicas`}
              icon={<Eye size={18} />}
            />
            <StatCard
              label="Inícios"
              value={stats.general.starts}
              hint={percent(stats.general.startRate)}
              icon={<MousePointerClick size={18} />}
            />
            <StatCard label="Participações" value={stats.general.participations} icon={<Users size={18} />} />
            <StatCard
              label="Conclusões"
              value={stats.general.completions}
              hint={percent(stats.general.completionRate)}
              icon={<CircleCheckBig size={18} />}
            />
            <StatCard
              label="Leads"
              value={stats.general.leads}
              hint={percent(stats.general.leadConversion)}
              icon={<UserPlus size={18} />}
            />
            <StatCard label="Bloqueios" value={stats.general.blocked} icon={<ShieldBan size={18} />} />
          </div>
        </section>

        <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
          <Card as="section" padding="lg" aria-labelledby="timeline-heading" className="min-w-0 lg:col-span-2">
            <h2 id="timeline-heading" className={cn(sectionHeadingClass, "mb-4")}>
              Participações por dia
            </h2>
            <ParticipationTimelineChart data={stats.general.timeline} />
          </Card>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-1 max-sm:[&>:last-child]:col-span-2">
            <StatCard
              label="Tempo médio"
              value={stats.general.avgTimeSeconds != null ? `${stats.general.avgTimeSeconds}s` : "—"}
              icon={<Timer size={18} />}
            />
            <StatCard
              label="Tráfego mobile"
              value={percent(stats.general.mobilePercent)}
              icon={<Smartphone size={18} />}
            />
            <StatCard
              label="Taxa de conclusão"
              value={percent(stats.general.completionRate)}
              icon={<Percent size={18} />}
            />
          </div>
        </div>

        <section aria-labelledby="audience-heading">
          <h2 id="audience-heading" className={cn(sectionHeadingClass, "mb-3 sm:mb-4")}>
            Audiência
          </h2>
          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <BreakdownCard title="Origem" icon={Compass} items={stats.general.bySource} />
            <BreakdownCard title="Dispositivo" icon={MonitorSmartphone} items={stats.general.byDevice} />
            <BreakdownCard title="Browser" icon={Globe} items={stats.general.byBrowser} />
            <BreakdownCard title="Sistema operativo" icon={Cpu} items={stats.general.byOs} />
          </div>
        </section>

        {stats.memory && (
          <GameSection id="memory-heading" title="Jogo da Memória" icon={Brain}>
            <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Pontuação média" value={stats.memory.avgScore} />
              <MetricTile label="Tempo médio" value={`${stats.memory.avgTimeSeconds}s`} />
              <MetricTile label="Tentativas médias" value={stats.memory.avgAttempts} />
              <MetricTile label="Taxa de conclusão" value={percent(stats.memory.completionRate)} />
            </div>
            {stats.memory.ranking.length > 0 && (
              <div className="mt-6">
                <h3 className={subHeadingClass}>
                  <Trophy size={16} aria-hidden="true" className="text-caetano-deep-blue-60" />
                  Ranking (top 10)
                </h3>
                <ol className="mt-2 divide-y divide-caetano-medium-gray-20">
                  {stats.memory.ranking.map((entry, i) => (
                    <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                          PODIUM_CLASSES[i] ?? "bg-caetano-medium-gray-20 text-caetano-anthracite",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 break-words font-medium text-caetano-anthracite">
                        {entry.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-caetano-anthracite-80">
                        <span className="font-bold text-caetano-deep-blue">{entry.score} pts</span> ·{" "}
                        {entry.timeSeconds}s
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </GameSection>
        )}

        {stats.wheel && (
          <GameSection id="wheel-heading" title="Roda da Sorte" icon={Disc3}>
            <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Rotações" value={stats.wheel.spins} />
              <MetricTile label="Vencedores" value={stats.wheel.winners} />
              <MetricTile label="Não vencedores" value={stats.wheel.nonWinners} />
              <MetricTile label="Taxa de vitória" value={percent(stats.wheel.winRate)} />
              <MetricTile label="Prémios atribuídos" value={stats.wheel.prizesAwarded} />
              <MetricTile label="Reservados agora" value={stats.wheel.prizesReserved} />
              <MetricTile label="Não reclamados" value={stats.wheel.prizesUnclaimed} />
              <MetricTile label="Recusados (duplicado ou bot)" value={stats.wheel.prizesRefused} />
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs text-caetano-anthracite-80">
              <Info size={14} aria-hidden="true" className="mt-px shrink-0 text-caetano-deep-blue-60" />
              <span>
                Com o formulário depois do jogo, o prémio sorteado fica reservado até a lead ser aceite. Taxa de
                reclamação: {percent(stats.wheel.claimRate)}.
              </span>
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <SubPanel title="Distribuição de prémios">
                <BarList
                  label="Distribuição de prémios"
                  items={toShareItems(
                    stats.wheel.prizeDistribution.map((p) => ({ label: p.prizeName, count: p.count })),
                  )}
                />
              </SubPanel>
              <SubPanel title="Stock atual">
                <BarList
                  label="Stock atual"
                  items={stats.wheel.stock.map(
                    (p): BarListItem => ({
                      label: p.prizeName,
                      value: p.remaining ?? 0,
                      max: p.total,
                      tone: p.remaining != null && p.remaining <= LOW_STOCK_THRESHOLD ? "warning" : "brand",
                      valueLabel:
                        p.total != null
                          ? `${p.remaining}/${p.total}${p.reserved > 0 ? ` · ${p.reserved} reservado${p.reserved === 1 ? "" : "s"}` : ""}`
                          : "Ilimitado",
                    }),
                  )}
                />
              </SubPanel>
            </div>
          </GameSection>
        )}

        {stats.quiz && (
          <GameSection id="quiz-heading" title="Quiz Interativo" icon={ListChecks}>
            <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Pontuação média" value={`${stats.quiz.avgPercentage}%`} />
              <MetricTile label="Taxa de aprovação" value={percent(stats.quiz.passRate)} />
              <MetricTile label="Tempo médio" value={`${stats.quiz.avgTimeSeconds}s`} />
              <MetricTile label="Abandono" value={percent(stats.quiz.abandonment)} />
            </div>
            <div className={cn("mt-6 grid gap-4", stats.quiz.profiles.length > 0 && "lg:grid-cols-2")}>
              <SubPanel title="Acerto por pergunta">
                <BarList
                  label="Acerto por pergunta"
                  items={stats.quiz.perQuestion.map(
                    (q): BarListItem => ({
                      label: q.title,
                      value: q.correctRate,
                      max: 1,
                      valueLabel: percent(q.correctRate),
                    }),
                  )}
                />
              </SubPanel>
              {stats.quiz.profiles.length > 0 && (
                <SubPanel title="Perfis de resultado">
                  <BarList
                    label="Perfis de resultado"
                    items={toShareItems(stats.quiz.profiles.map((p) => ({ label: p.title, count: p.count })))}
                  />
                </SubPanel>
              )}
            </div>
          </GameSection>
        )}
      </div>
    </div>
  );
}

/** Pódio do ranking: o amarelo liberdade para o 1.º, tons claros para os seguintes. */
const PODIUM_CLASSES = [
  "bg-caetano-freedom-yellow text-caetano-deep-blue",
  "bg-caetano-medium-gray-40 text-caetano-deep-blue",
  "bg-caetano-dynamic-orange-40 text-caetano-deep-blue",
];

/**
 * Data de fim de campanha para os alertas. O fuso é o do servidor porque o
 * agendamento é guardado em UTC e a plataforma opera em Europe/Lisbon.
 */
function formatEndDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

/**
 * O período das métricas, por extenso. O intervalo personalizado chega como
 * datas sem hora (meia-noite UTC), por isso formata-se em UTC.
 */
function periodLabel(range: DateRange): string {
  if (range.preset !== "custom") {
    return PERIOD_OPTIONS.find((option) => option.value === range.preset)?.label ?? "";
  }
  const format = new Intl.DateTimeFormat("pt-PT", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  return `${format.format(range.from)} – ${format.format(range.to)}`;
}

/** Contagens como parte do total: a barra é a fatia de cada linha. */
function toShareItems(rows: Array<{ label: string; count: number }>): BarListItem[] {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => ({ label: row.label, value: row.count, max: total }));
}

function AlertIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: "ending" | "stock" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-caetano-anthracite ring-1",
        tone === "ending"
          ? "bg-caetano-freedom-yellow-20 ring-caetano-freedom-yellow-60"
          : "bg-caetano-dynamic-orange-20 ring-caetano-dynamic-orange-40",
      )}
    >
      <Icon size={15} />
    </span>
  );
}

function GameSection({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Card as="section" padding="lg" aria-labelledby={id}>
      <div className="mb-5 flex items-center gap-3">
        {/* O ícone na superfície de marca: do azul profundo ao azul cyan. */}
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-135 from-caetano-deep-blue to-caetano-cyan text-white shadow-sm"
        >
          <Icon size={20} />
        </span>
        <h2 id={id} className={sectionHeadingClass}>
          {title}
        </h2>
      </div>
      {children}
    </Card>
  );
}

function SubPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-caetano-medium-gray-40 p-4">
      <h3 className={cn(subHeadingClass, "mb-3")}>{title}</h3>
      {children}
    </div>
  );
}

function BreakdownCard({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: LucideIcon;
  items: Array<{ key: string; count: number }>;
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <Card className="min-w-0">
      <h3 className={cn(subHeadingClass, "mb-3")}>
        <Icon size={16} aria-hidden="true" className="text-caetano-deep-blue-60" />
        {title}
      </h3>
      <BarList
        label={title}
        items={items.slice(0, 6).map((item) => ({ label: item.key, value: item.count, max: total }))}
      />
    </Card>
  );
}
