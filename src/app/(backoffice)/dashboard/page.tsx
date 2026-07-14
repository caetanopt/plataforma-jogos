import Link from "next/link";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { getDashboardMetrics } from "@/features/analytics/dashboard-metrics";
import { resolveDateRange } from "@/lib/dates/range";
import { StatCard } from "@/components/backoffice/stat-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CAMPAIGN_TYPE_LABELS, CAMPAIGN_STATUS_LABELS } from "@/lib/labels";

interface DashboardSearchParams {
  period?: string;
  from?: string;
  to?: string;
  workspaceId?: string;
  folderId?: string;
  type?: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  const range = resolveDateRange(params);

  const type =
    params.type === "MEMORY" || params.type === "WHEEL" || params.type === "QUIZ"
      ? params.type
      : undefined;

  const [metrics, workspaces, folders] = await Promise.all([
    getDashboardMetrics(context.organizationId, range, {
      workspaceId: params.workspaceId,
      folderId: params.folderId,
      type,
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
  ]);

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-caetano-anthracite">
            Boa tarde, {context.userName.split(" ")[0]}
          </h1>
          <p className="mt-1 text-caetano-medium-gray">
            Resumo das suas campanhas de angariação de leads.
          </p>
        </div>
        <Link href="/apps/new" className={buttonVariants()}>
          Criar aplicação
        </Link>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <div>
          <Label htmlFor="period">Período</Label>
          <select id="period" name="period" defaultValue={range.preset} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <Label htmlFor="from">De (personalizado)</Label>
          <input
            id="from"
            type="date"
            name="from"
            defaultValue={params.from}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="to">Até (personalizado)</Label>
          <input
            id="to"
            type="date"
            name="to"
            defaultValue={params.to}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="workspaceId">Espaço de trabalho</Label>
          <select
            id="workspaceId"
            name="workspaceId"
            defaultValue={params.workspaceId ?? ""}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="">Todos</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="folderId">Pasta / marca</Label>
          <select
            id="folderId"
            name="folderId"
            defaultValue={params.folderId ?? ""}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="">Todas</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
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
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Publicados" value={metrics.published} />
        <StatCard label="Rascunhos" value={metrics.drafts} />
        <StatCard label="Agendados" value={metrics.scheduled} />
        <StatCard label="Visualizações" value={metrics.views} />
        <StatCard label="Participações" value={metrics.participations} />
        <StatCard label="Leads" value={metrics.leads} />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-2">
        <StatCard label="Taxa de conclusão" value={percent(metrics.completionRate)} />
        <StatCard label="Conversão em lead" value={percent(metrics.conversionRate)} />
      </div>

      {(metrics.endingSoon.length > 0 || metrics.stockAlerts.length > 0) && (
        <div className="mb-6 space-y-2">
          {metrics.endingSoon.map((campaign) => (
            <div key={campaign.id} className="rounded-lg border border-caetano-dynamic-orange/40 bg-caetano-dynamic-orange/10 px-4 py-2 text-sm text-caetano-anthracite">
              A campanha <strong>{campaign.internalName}</strong> termina brevemente.
            </div>
          ))}
          {metrics.stockAlerts.map((prize) => (
            <div key={prize.id} className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
              Stock baixo no prémio <strong>{prize.publicName}</strong> (
              {(prize.totalQuantity ?? 0) - prize.awardedQuantity} restantes).
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Campanhas recentes</h2>
          {metrics.recentCampaigns.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-caetano-medium-gray/20">
              {metrics.recentCampaigns.map((campaign) => (
                <li key={campaign.id} className="py-2 text-sm">
                  <Link href={`/apps/${campaign.id}`} className="font-medium text-caetano-deep-blue hover:underline">
                    {campaign.internalName}
                  </Link>
                  <p className="text-caetano-medium-gray">
                    {CAMPAIGN_TYPE_LABELS[campaign.type]} · {CAMPAIGN_STATUS_LABELS[campaign.status]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Campanhas ativas</h2>
          {metrics.activeCampaigns.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="divide-y divide-caetano-medium-gray/20">
              {metrics.activeCampaigns.map((campaign) => (
                <li key={campaign.id} className="py-2 text-sm">
                  <Link href={`/apps/${campaign.id}`} className="font-medium text-caetano-deep-blue hover:underline">
                    {campaign.internalName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <p className="py-6 text-center text-sm text-caetano-medium-gray">
      Ainda não há dados para mostrar.
    </p>
  );
}
