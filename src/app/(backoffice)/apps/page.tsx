import Link from "next/link";
import { pageParam } from "@/lib/forms/search-params";
import { FilterX, Folder, LayoutGrid, List, Plus, Search, SearchX, Sparkles } from "lucide-react";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { can } from "@/server/permissions";
import { listCampaigns } from "@/features/campaigns/queries";
import { CAMPAIGN_TYPE_LABELS, CAMPAIGN_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { CampaignRowActions } from "@/components/backoffice/campaign-row-actions";
import { CampaignCard, campaignPrimaryHref } from "@/components/backoffice/home-apps/campaign-card";
import { CampaignStatusBadge } from "@/components/backoffice/home-apps/campaign-status-badge";
import { GameTypeTile } from "@/components/backoffice/home-apps/game-type-art";
import { Select } from "@/components/ui/select";
import type { CampaignStatus, CampaignType } from "@/generated/prisma/client";

export const metadata = { title: "Aplicações" };

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "Aplicação não encontrada ou sem permissão para a alterar.",
  validation: "Dados inválidos. Verifique a pasta de destino.",
  invalid_state: "A operação não é possível no estado atual da aplicação.",
};

interface AppsSearchParams {
  error?: string;
  q?: string;
  status?: string;
  type?: string;
  workspaceId?: string;
  folderId?: string;
  sort?: string;
  view?: string;
  page?: string;
}

const VALID_STATUSES: CampaignStatus[] = [
  "DRAFT",
  "IN_REVIEW",
  "SCHEDULED",
  "PUBLISHED",
  "PAUSED",
  "EXPIRED",
  "ARCHIVED",
];
const VALID_TYPES: CampaignType[] = ["MEMORY", "WHEEL", "QUIZ"];

/** Etiquetas dos filtros: pequenas e discretas, para os valores se lerem primeiro. */
const filterLabelClass = "text-xs text-caetano-anthracite-80";

const thClass = "px-4 py-3 font-medium";

export default async function AppsListPage({
  searchParams,
}: {
  searchParams: Promise<AppsSearchParams>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();

  const status = VALID_STATUSES.find((s) => s === params.status);
  const type = VALID_TYPES.find((t) => t === params.type);
  const view = params.view === "grid" ? "grid" : "list";
  const page = pageParam(params.page);

  const [{ items, total, pageCount }, workspaces, folders] = await Promise.all([
    listCampaigns(context.organizationId, {
      search: params.q,
      status,
      type,
      workspaceId: params.workspaceId,
      folderId: params.folderId,
      sort: params.sort === "created_desc" || params.sort === "name_asc" ? params.sort : "updated_desc",
      page,
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

  const canEdit = can(context, "campaign:edit");
  const canViewLeads = can(context, "leads:view");
  const canPublish = can(context, "campaign:publish");
  const canArchive = can(context, "campaign:archive");
  const canDelete = can(context, "campaign:delete");
  const canCreate = can(context, "campaign:create");
  const permissions = { canEdit, canViewLeads, canPublish, canArchive, canDelete };

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    return `/apps?${next.toString()}`;
  };

  const hasFilters = Boolean(params.q || params.status || params.type || params.workspaceId || params.folderId);
  const clearFiltersHref = view === "grid" ? "/apps?view=grid" : "/apps";

  const viewOptions = [
    { key: "list", label: "Lista", icon: List },
    { key: "grid", label: "Grelha", icon: LayoutGrid },
  ] as const;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Aplicações"
        description={<>{total} aplicações encontradas.</>}
        actions={
          canCreate && (
            <Link href="/apps/new" className={buttonVariants()}>
              <Plus size={16} aria-hidden="true" />
              Criar aplicação
            </Link>
          )
        }
      />

      {params.error && (
        <div className="mb-6">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      <Card as="form" method="get" padding="none" className="mb-6 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor="q" className={filterLabelClass}>
              Pesquisar
            </Label>
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-3 my-auto text-caetano-anthracite-80"
              />
              <Input id="q" name="q" defaultValue={params.q} placeholder="Nome da campanha…" className="pl-9" />
            </div>
          </div>
          <div className="lg:w-64">
            <Label htmlFor="sort" className={filterLabelClass}>
              Ordenar por
            </Label>
            <Select id="sort" name="sort" defaultValue={params.sort ?? "updated_desc"}>
              <option value="updated_desc">Atualização mais recente</option>
              <option value="created_desc">Criação mais recente</option>
              <option value="name_asc">Nome (A-Z)</option>
            </Select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 items-end gap-3 lg:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          <div className="min-w-0">
            <Label htmlFor="status" className={filterLabelClass}>
              Estado
            </Label>
            <Select id="status" name="status" defaultValue={params.status ?? ""}>
              <option value="">Todos</option>
              {VALID_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CAMPAIGN_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="type" className={filterLabelClass}>
              Tipo
            </Label>
            <Select id="type" name="type" defaultValue={params.type ?? ""}>
              <option value="">Todos</option>
              {VALID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CAMPAIGN_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="workspaceId" className={filterLabelClass}>
              Espaço de trabalho
            </Label>
            <Select id="workspaceId" name="workspaceId" defaultValue={params.workspaceId ?? ""}>
              <option value="">Todos</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-0">
            <Label htmlFor="folderId" className={filterLabelClass}>
              Pasta
            </Label>
            <Select id="folderId" name="folderId" defaultValue={params.folderId ?? ""}>
              <option value="">Todas</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-2 flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end lg:col-span-4 xl:col-span-1 xl:pt-0">
            {hasFilters && (
              <Link href={clearFiltersHref} className={buttonVariants({ variant: "ghost" })}>
                <FilterX size={16} aria-hidden="true" />
                Limpar filtros
              </Link>
            )}
            <Button type="submit" variant="outline">
              Aplicar filtros
            </Button>
          </div>
        </div>

        <input type="hidden" name="view" value={view} />
      </Card>

      <div className="mb-4 flex justify-end">
        {/* Alternar a vista: duas ligações (funcionam sem JavaScript) num controlo segmentado. */}
        <div className="inline-flex gap-1 rounded-xl border border-caetano-medium-gray-40 bg-white p-1 shadow-xs">
          {viewOptions.map((option) => {
            const isActive = view === option.key;
            const Icon = option.icon;
            return (
              <Link
                key={option.key}
                href={buildUrl({ view: option.key })}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium",
                  "transition-[background-color,color,box-shadow] duration-200 ease-(--ease-out-expo)",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
                  isActive
                    ? "bg-caetano-deep-blue text-white shadow-sm"
                    : "text-caetano-anthracite hover:bg-caetano-medium-gray-20",
                )}
              >
                <Icon size={16} aria-hidden="true" />
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>

      {items.length === 0 ? (
        <Card
          padding="none"
          className="border-dashed border-caetano-medium-gray-60 bg-[radial-gradient(70%_90%_at_50%_0%,var(--color-caetano-cyan-20),var(--color-caetano-ultra-white)_70%)]"
        >
          {hasFilters ? (
            <EmptyState
              icon={<SearchX size={24} />}
              title="Nenhuma aplicação encontrada com estes filtros."
              description="Experimente outros termos de pesquisa ou retire alguns filtros."
              action={
                <Link href={clearFiltersHref} className={buttonVariants({ variant: "outline" })}>
                  <FilterX size={16} aria-hidden="true" />
                  Limpar filtros
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<Sparkles size={24} />}
              title="Ainda não há aplicações"
              description="Crie um Jogo da Memória, uma Roda da Sorte ou um Quiz Interativo para começar a angariar leads."
              action={
                canCreate ? (
                  <Link href="/apps/new" className={buttonVariants()}>
                    <Plus size={16} aria-hidden="true" />
                    Criar aplicação
                  </Link>
                ) : undefined
              }
            />
          )}
        </Card>
      ) : view === "grid" ? (
        <ul className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {items.map((campaign) => (
            <li key={campaign.id} className="relative has-[details[open]]:z-30">
              <CampaignCard campaign={campaign} permissions={permissions} />
            </li>
          ))}
        </ul>
      ) : (
        <Card
          padding="none"
          tabIndex={0}
          role="region"
          aria-label="Tabela de aplicações"
          // Quando a tabela cabe (xl), o contentor deixa de cortar: o menu de
          // ações das linhas pode sair por cima ou por baixo do cartão.
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan xl:overflow-visible"
        >
          <table className="w-full min-w-[880px] text-left text-sm">
            <caption className="sr-only">Aplicações da organização</caption>
            <thead className="border-b border-caetano-medium-gray-40 text-xs uppercase tracking-[0.08em] text-caetano-anthracite-80">
              <tr>
                <th scope="col" className={thClass}>Nome</th>
                <th scope="col" className={thClass}>Tipo</th>
                <th scope="col" className={thClass}>Pasta</th>
                <th scope="col" className={thClass}>Estado</th>
                <th scope="col" className={thClass}>Autor</th>
                <th scope="col" className={thClass}>Atualização</th>
                <th scope="col" className={cn(thClass, "text-right")}>Participações</th>
                <th scope="col" className="w-14 px-2 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-caetano-medium-gray-20">
              {items.map((campaign, index) => (
                <tr
                  key={campaign.id}
                  // O fundo ao passar o rato fica nas células: na última linha
                  // arredondam com o cartão em vez de lhe tapar os cantos.
                  className="[&>td]:transition-colors [&>td]:duration-150 hover:[&>td]:bg-caetano-medium-gray-20 last:[&>td:first-child]:rounded-bl-2xl last:[&>td:last-child]:rounded-br-2xl"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <GameTypeTile type={campaign.type} />
                      <div className="min-w-0">
                        <Link
                          href={campaignPrimaryHref(campaign.id, canEdit)}
                          className="block max-w-64 truncate rounded font-bold text-caetano-deep-blue underline-offset-4 decoration-caetano-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
                        >
                          {campaign.internalName}
                        </Link>
                        <p className="truncate text-xs text-caetano-anthracite-80">{campaign.workspace.name}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caetano-anthracite-80">
                    {CAMPAIGN_TYPE_LABELS[campaign.type]}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {campaign.folder ? (
                      <span className="inline-flex max-w-40 items-center gap-1.5">
                        <Folder size={14} aria-hidden="true" className="shrink-0" />
                        <span className="truncate">{campaign.folder.name}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <CampaignStatusBadge status={campaign.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-caetano-anthracite-80">{campaign.owner.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-caetano-anthracite-80">
                    {campaign.updatedAt.toLocaleDateString("pt-PT")}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-caetano-anthracite">
                    {campaign._count.participations}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <CampaignRowActions
                      campaignId={campaign.id}
                      status={campaign.status}
                      {...permissions}
                      // A segunda metade de uma tabela comprida abre o menu
                      // para cima, para não o cortar no fundo da tabela.
                      openUpward={items.length >= 6 && index >= Math.ceil(items.length / 2)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        buildHref={(p) => buildUrl({ page: String(p) })}
        label="Paginação das aplicações"
      />
    </div>
  );
}
