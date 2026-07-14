import Link from "next/link";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { can } from "@/server/permissions";
import { listCampaigns } from "@/features/campaigns/queries";
import { CAMPAIGN_TYPE_LABELS, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONE } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CampaignRowActions } from "@/components/backoffice/campaign-row-actions";
import type { CampaignStatus, CampaignType } from "@/generated/prisma/client";

interface AppsSearchParams {
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
  const page = Math.max(1, Number(params.page ?? 1) || 1);

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
  const canPublish = can(context, "campaign:publish");
  const canArchive = can(context, "campaign:archive");
  const canDelete = can(context, "campaign:delete");
  const canCreate = can(context, "campaign:create");

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    const merged = { ...params, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    return `/apps?${next.toString()}`;
  };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-caetano-anthracite">Aplicações</h1>
          <p className="mt-1 text-caetano-medium-gray">{total} aplicações encontradas.</p>
        </div>
        {canCreate && (
          <Link href="/apps/new" className={buttonVariants()}>
            Criar aplicação
          </Link>
        )}
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <div className="min-w-[200px] flex-1">
          <Label htmlFor="q">Pesquisar</Label>
          <Input id="q" name="q" defaultValue={params.q} placeholder="Nome da campanha…" />
        </div>
        <div>
          <Label htmlFor="status">Estado</Label>
          <select id="status" name="status" defaultValue={params.status ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todos</option>
            {VALID_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CAMPAIGN_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="type">Tipo</Label>
          <select id="type" name="type" defaultValue={params.type ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todos</option>
            {VALID_TYPES.map((t) => (
              <option key={t} value={t}>
                {CAMPAIGN_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="workspaceId">Espaço de trabalho</Label>
          <select id="workspaceId" name="workspaceId" defaultValue={params.workspaceId ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todos</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="folderId">Pasta</Label>
          <select id="folderId" name="folderId" defaultValue={params.folderId ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todas</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="sort">Ordenar por</Label>
          <select id="sort" name="sort" defaultValue={params.sort ?? "updated_desc"} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="updated_desc">Atualização mais recente</option>
            <option value="created_desc">Criação mais recente</option>
            <option value="name_asc">Nome (A-Z)</option>
          </select>
        </div>
        <input type="hidden" name="view" value={view} />
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      <div className="mb-4 flex justify-end gap-2">
        <Link
          href={buildUrl({ view: "list" })}
          className={buttonVariants({ variant: view === "list" ? "secondary" : "outline", size: "sm" })}
        >
          Lista
        </Link>
        <Link
          href={buildUrl({ view: "grid" })}
          className={buttonVariants({ variant: view === "grid" ? "secondary" : "outline", size: "sm" })}
        >
          Grelha
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-10 text-center text-caetano-medium-gray">
          Nenhuma aplicação encontrada com estes filtros.
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((campaign) => (
            <div key={campaign.id} className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-caetano-anthracite">{campaign.internalName}</p>
                  <p className="text-sm text-caetano-medium-gray">
                    {CAMPAIGN_TYPE_LABELS[campaign.type]} · {campaign.folder?.name ?? "Sem pasta"}
                  </p>
                </div>
                <CampaignRowActions
                  campaignId={campaign.id}
                  status={campaign.status}
                  canEdit={canEdit}
                  canPublish={canPublish}
                  canArchive={canArchive}
                  canDelete={canDelete}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
                  {CAMPAIGN_STATUS_LABELS[campaign.status]}
                </Badge>
                <span className="text-xs text-caetano-medium-gray">
                  {campaign._count.participations} participações
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-caetano-medium-gray/30 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-caetano-medium-gray/30 text-caetano-medium-gray">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Pasta</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Autor</th>
                <th className="px-4 py-3 font-medium">Atualização</th>
                <th className="px-4 py-3 font-medium">Participações</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-caetano-medium-gray/20">
              {items.map((campaign) => (
                <tr key={campaign.id}>
                  <td className="px-4 py-3 font-medium text-caetano-anthracite">
                    {campaign.internalName}
                  </td>
                  <td className="px-4 py-3 text-caetano-medium-gray">
                    {CAMPAIGN_TYPE_LABELS[campaign.type]}
                  </td>
                  <td className="px-4 py-3 text-caetano-medium-gray">
                    {campaign.folder?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
                      {CAMPAIGN_STATUS_LABELS[campaign.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-caetano-medium-gray">{campaign.owner.name}</td>
                  <td className="px-4 py-3 text-caetano-medium-gray">
                    {campaign.updatedAt.toLocaleDateString("pt-PT")}
                  </td>
                  <td className="px-4 py-3 text-caetano-medium-gray">
                    {campaign._count.participations}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CampaignRowActions
                      campaignId={campaign.id}
                      status={campaign.status}
                      canEdit={canEdit}
                      canPublish={canPublish}
                      canArchive={canArchive}
                      canDelete={canDelete}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="mt-4 flex justify-center gap-2">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={buildUrl({ page: String(p) })}
              className={buttonVariants({ variant: p === page ? "secondary" : "outline", size: "sm" })}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
