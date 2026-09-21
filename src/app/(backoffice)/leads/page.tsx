import Link from "next/link";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { resolveDateRange } from "@/lib/dates/range";
import { listLeads } from "@/features/leads/queries";
import { toLeadRow } from "@/features/leads/format";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";

export const metadata = { title: "Leads" };

interface LeadsSearchParams {
  campaignId?: string;
  search?: string;
  period?: string;
  from?: string;
  to?: string;
  excludeTest?: string;
  page?: string;
}

const STATUS_LABELS: Record<string, string> = {
  STARTED: "Iniciada",
  COMPLETED: "Concluída",
  ABANDONED: "Abandonada",
  BLOCKED: "Bloqueada",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<LeadsSearchParams>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  assertCan(context, "leads:view");
  const range = resolveDateRange(params);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const excludeTest = params.excludeTest !== "false";

  const [campaigns, leads] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, internalName: true },
      orderBy: { internalName: "asc" },
    }),
    listLeads(context.organizationId, range, {
      campaignId: params.campaignId || undefined,
      search: params.search || undefined,
      excludeTest,
      page,
    }),
  ]);

  const rows = leads.items.map(toLeadRow);
  const canExport = can(context, "leads:export");

  const exportQuery = new URLSearchParams({
    ...(params.campaignId ? { campaignId: params.campaignId } : {}),
    ...(params.search ? { search: params.search } : {}),
    period: range.preset,
    ...(range.preset === "custom" ? { from: params.from ?? "", to: params.to ?? "" } : {}),
    excludeTest: String(excludeTest),
  }).toString();

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-caetano-anthracite">Leads</h1>
          <p className="mt-1 text-caetano-anthracite-80">Participações e leads angariados nas suas campanhas.</p>
        </div>
        {canExport && (
          <a href={`/api/leads/export?${exportQuery}`} className={buttonVariants({ variant: "outline" })}>
            Exportar CSV
          </a>
        )}
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
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
          <Label htmlFor="search">Pesquisar</Label>
          <Input id="search" name="search" placeholder="Nome, e-mail ou telefone" defaultValue={params.search ?? ""} />
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
        <label className="flex h-10 items-center gap-2 text-sm text-caetano-anthracite">
          <input type="checkbox" name="excludeTest" value="true" defaultChecked={excludeTest} className="h-4 w-4 rounded border-caetano-medium-gray" />
          Excluir participações de teste
        </label>
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      <div
        tabIndex={0}
        role="region"
        aria-label="Tabela de leads"
        className="overflow-x-auto rounded-xl border border-caetano-medium-gray-40 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Participações e leads recolhidos</caption>
          <thead>
            <tr className="border-b border-caetano-medium-gray-20 text-left text-xs uppercase text-caetano-anthracite-80">
              <th scope="col" className="px-4 py-3">Data</th>
              <th scope="col" className="px-4 py-3">Campanha</th>
              <th scope="col" className="px-4 py-3">Nome</th>
              <th scope="col" className="px-4 py-3">Contacto</th>
              <th scope="col" className="px-4 py-3">Estado</th>
              <th scope="col" className="px-4 py-3">Resultado</th>
              <th scope="col" className="px-4 py-3">Prémio</th>
              <th scope="col" className="px-4 py-3">Origem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-caetano-medium-gray-20">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-caetano-anthracite-80">
                  Nenhuma participação encontrada para os filtros atuais.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-caetano-anthracite-80">
                    {row.createdAt.toLocaleString("pt-PT")}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/apps/${row.campaignId}/informacoes`} className="hover:underline">
                      {row.campaignName}
                    </Link>
                    <span className="ml-1 text-xs text-caetano-anthracite-80">
                      ({CAMPAIGN_TYPE_LABELS[row.campaignType as keyof typeof CAMPAIGN_TYPE_LABELS]})
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.name || "—"}</td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.email || row.phone || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.status === "COMPLETED" ? "success" : "neutral"}>
                      {STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                    {row.isTest && (
                      <Badge tone="warning">Teste</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.result} {row.score && `· ${row.score}`}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.prize}
                    {row.code && <span className="ml-1 font-mono text-xs">({row.code})</span>}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">{row.source || row.utmSource || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={leads.page}
        pageCount={leads.pageCount}
        total={leads.total}
        label="Paginação de leads"
        buildHref={(target) =>
          `/leads?${new URLSearchParams({
            ...(params.campaignId ? { campaignId: params.campaignId } : {}),
            ...(params.search ? { search: params.search } : {}),
            period: range.preset,
            ...(range.preset === "custom" ? { from: params.from ?? "", to: params.to ?? "" } : {}),
            excludeTest: String(excludeTest),
            page: String(target),
          }).toString()}`
        }
      />
    </div>
  );
}
