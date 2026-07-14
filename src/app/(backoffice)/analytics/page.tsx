import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { resolveDateRange } from "@/lib/dates/range";
import { getCampaignStats } from "@/features/analytics/campaign-stats";
import { StatCard } from "@/components/backoffice/stat-card";
import { ParticipationTimelineChart } from "@/components/charts/participation-timeline-chart";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";

interface AnalyticsSearchParams {
  campaignId?: string;
  period?: string;
  from?: string;
  to?: string;
  type?: string;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<AnalyticsSearchParams>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  assertCan(context, "stats:view");
  const range = resolveDateRange(params);

  const type =
    params.type === "MEMORY" || params.type === "WHEEL" || params.type === "QUIZ" ? params.type : undefined;

  const [campaigns, stats] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, internalName: true, type: true },
      orderBy: { internalName: "asc" },
    }),
    getCampaignStats(context.organizationId, range, {
      campaignId: params.campaignId || undefined,
      type,
    }),
  ]);

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-caetano-anthracite">Estatísticas</h1>
        <p className="mt-1 text-caetano-medium-gray">
          Métricas de visualizações, participações e conversão das suas campanhas.
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <div>
          <Label htmlFor="campaignId">Campanha</Label>
          <select
            id="campaignId"
            name="campaignId"
            defaultValue={params.campaignId ?? ""}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="">Todas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.internalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="type">Tipo de jogo</Label>
          <select id="type" name="type" defaultValue={params.type ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todos</option>
            {Object.entries(CAMPAIGN_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="period">Período</Label>
          <select id="period" name="period" defaultValue={range.preset} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="all">Todo o período</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <Label htmlFor="from">De</Label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm" />
        </div>
        <div>
          <Label htmlFor="to">Até</Label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm" />
        </div>
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Visualizações" value={stats.general.views} hint={`${stats.general.uniqueViews} únicas`} />
        <StatCard label="Inícios" value={stats.general.starts} hint={percent(stats.general.startRate)} />
        <StatCard label="Participações" value={stats.general.participations} />
        <StatCard label="Conclusões" value={stats.general.completions} hint={percent(stats.general.completionRate)} />
        <StatCard label="Leads" value={stats.general.leads} hint={percent(stats.general.leadConversion)} />
        <StatCard label="Bloqueios" value={stats.general.blocked} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Tempo médio"
          value={stats.general.avgTimeSeconds != null ? `${stats.general.avgTimeSeconds}s` : "—"}
        />
        <StatCard label="Tráfego mobile" value={percent(stats.general.mobilePercent)} />
        <StatCard label="Taxa de conclusão" value={percent(stats.general.completionRate)} />
      </div>

      <div className="mb-6 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Participações por dia</h2>
        <ParticipationTimelineChart data={stats.general.timeline} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BreakdownCard title="Origem" items={stats.general.bySource} />
        <BreakdownCard title="Dispositivo" items={stats.general.byDevice} />
        <BreakdownCard title="Browser" items={stats.general.byBrowser} />
      </div>

      {stats.memory && (
        <section className="mb-6 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Jogo da Memória</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Pontuação média" value={stats.memory.avgScore} />
            <StatCard label="Tempo médio" value={`${stats.memory.avgTimeSeconds}s`} />
            <StatCard label="Tentativas médias" value={stats.memory.avgAttempts} />
            <StatCard label="Taxa de conclusão" value={percent(stats.memory.completionRate)} />
          </div>
          {stats.memory.ranking.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">Ranking (top 10)</h3>
              <ol className="space-y-1 text-sm">
                {stats.memory.ranking.map((entry, i) => (
                  <li key={i} className="flex justify-between border-b border-caetano-medium-gray/10 py-1">
                    <span>{i + 1}. {entry.name}</span>
                    <span className="text-caetano-medium-gray">{entry.score} pts · {entry.timeSeconds}s</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}

      {stats.wheel && (
        <section className="mb-6 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Roda da Sorte</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Rotações" value={stats.wheel.spins} />
            <StatCard label="Vencedores" value={stats.wheel.winners} />
            <StatCard label="Não vencedores" value={stats.wheel.nonWinners} />
            <StatCard label="Taxa de vitória" value={percent(stats.wheel.winRate)} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">Distribuição de prémios</h3>
              <ul className="space-y-1 text-sm">
                {stats.wheel.prizeDistribution.map((p) => (
                  <li key={p.prizeName} className="flex justify-between">
                    <span>{p.prizeName}</span>
                    <span className="text-caetano-medium-gray">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">Stock atual</h3>
              <ul className="space-y-1 text-sm">
                {stats.wheel.stock.map((p) => (
                  <li key={p.prizeName} className="flex justify-between">
                    <span>{p.prizeName}</span>
                    <span className="text-caetano-medium-gray">
                      {p.total != null ? `${p.remaining}/${p.total}` : "Ilimitado"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {stats.quiz && (
        <section className="mb-6 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Quiz Interativo</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Pontuação média" value={`${stats.quiz.avgPercentage}%`} />
            <StatCard label="Taxa de aprovação" value={percent(stats.quiz.passRate)} />
            <StatCard label="Tempo médio" value={`${stats.quiz.avgTimeSeconds}s`} />
            <StatCard label="Abandono" value={percent(stats.quiz.abandonment)} />
          </div>
          <div className="mt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">Acerto por pergunta</h3>
            <ul className="space-y-1 text-sm">
              {stats.quiz.perQuestion.map((q) => (
                <li key={q.title} className="flex justify-between">
                  <span>{q.title}</span>
                  <span className="text-caetano-medium-gray">{percent(q.correctRate)}</span>
                </li>
              ))}
            </ul>
          </div>
          {stats.quiz.profiles.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">Perfis de resultado</h3>
              <ul className="space-y-1 text-sm">
                {stats.quiz.profiles.map((p) => (
                  <li key={p.title} className="flex justify-between">
                    <span>{p.title}</span>
                    <span className="text-caetano-medium-gray">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function BreakdownCard({ title, items }: { title: string; items: Array<{ key: string; count: number }> }) {
  return (
    <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase text-caetano-medium-gray">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-caetano-medium-gray">Sem dados.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.slice(0, 6).map((item) => (
            <li key={item.key} className="flex justify-between">
              <span>{item.key}</span>
              <span className="text-caetano-medium-gray">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
