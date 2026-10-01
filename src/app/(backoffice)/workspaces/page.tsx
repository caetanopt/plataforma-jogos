import { Building2, Folder, LayoutGrid, Layers, Pencil } from "lucide-react";
import { pageParam } from "@/lib/forms/search-params";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { createWorkspaceAction, renameWorkspaceAction } from "@/features/workspaces/actions";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DetailsMenu } from "@/components/ui/details-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { BrandFormPanel } from "@/components/backoffice/admin/brand-form-panel";

export const metadata = { title: "Espaços de trabalho" };

const PAGE_SIZE = 20;

/*
  As ações de espaço redirecionam com ?error=..., mas a página não aceitava
  searchParams: o utilizador via a operação falhar em silêncio.
*/
const ERROR_MESSAGES: Record<string, string> = {
  validation: "Verifique o nome do espaço de trabalho (até 120 caracteres).",
  not_found: "Espaço de trabalho não encontrado.",
};

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; page?: string }>;
}) {
  const params = await searchParams;
  // A navegação só mostra a entrada a quem gere espaços; a página segue a
  // mesma regra.
  const context = await requirePagePermission("workspace:manage");
  const canManage = can(context, "workspace:manage");

  const page = pageParam(params.page);
  const where = { organizationId: context.organizationId };

  const [workspaces, total] = await Promise.all([
    prisma.workspace.findMany({
      where,
      orderBy: { name: "asc" },
      include: { _count: { select: { campaigns: true, folders: true } } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.workspace.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Espaços de trabalho"
        description="Agrupam campanhas, utilizadores e permissões por marca, departamento ou cliente."
      />

      {params.error && (
        <div className="mb-6">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      {workspaces.length === 0 ? (
        <Card
          padding="none"
          className="border-dashed border-caetano-medium-gray-60 bg-[radial-gradient(70%_90%_at_50%_0%,var(--color-caetano-cyan-20),var(--color-caetano-ultra-white)_70%)]"
        >
          <EmptyState
            icon={<Layers size={24} />}
            title="Ainda não existe nenhum espaço de trabalho"
            description="Os espaços agrupam campanhas, utilizadores e permissões por marca, departamento ou cliente."
          />
        </Card>
      ) : (
        <ul className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {workspaces.map((workspace) => (
            // O formulário aberto de um espaço passa por cima dos cartões seguintes.
            <li key={workspace.id} className="relative has-[details[open]]:z-30">
              <Card className="flex h-full flex-col">
                <div className="flex items-start gap-3.5">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-135 from-caetano-deep-blue to-caetano-cyan text-white shadow-sm"
                  >
                    <Building2 size={20} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h2 className="break-words text-base font-bold leading-snug text-caetano-deep-blue">
                      {workspace.name}
                    </h2>
                    {workspace.description && (
                      <p className="mt-1 line-clamp-3 text-sm text-caetano-anthracite-80">{workspace.description}</p>
                    )}
                  </div>

                  {canManage && (
                    <div className="shrink-0">
                      <DetailsMenu
                        label={
                          <>
                            <Pencil size={14} aria-hidden="true" />
                            Editar
                          </>
                        }
                        summaryClassName="h-9 w-auto gap-1.5 px-3 text-sm font-medium text-caetano-deep-blue"
                        panelClassName="w-[min(18rem,calc(100vw-3rem))] p-3"
                      >
                        <form action={renameWorkspaceAction} className="space-y-3">
                          <input type="hidden" name="workspaceId" value={workspace.id} />
                          {/* Labels visíveis; o nome acessível (aria-label) começa pelo mesmo texto
                              e diz de que espaço se trata (WCAG 2.5.3). */}
                          <div>
                            <Label htmlFor={`workspace-${workspace.id}-name`} className="text-xs">
                              Nome
                            </Label>
                            <Input
                              id={`workspace-${workspace.id}-name`}
                              name="name"
                              defaultValue={workspace.name}
                              required
                              aria-label={`Nome do espaço ${workspace.name}`}
                            />
                          </div>
                          <div>
                            <Label htmlFor={`workspace-${workspace.id}-description`} className="text-xs">
                              Descrição
                            </Label>
                            <Input
                              id={`workspace-${workspace.id}-description`}
                              name="description"
                              defaultValue={workspace.description ?? ""}
                              placeholder="Descrição (opcional)"
                              aria-label={`Descrição do espaço ${workspace.name}`}
                            />
                          </div>
                          <SubmitButton pendingLabel="A guardar…" size="sm" className="w-full">
                            Guardar
                          </SubmitButton>
                        </form>
                      </DetailsMenu>
                    </div>
                  )}
                </div>

                {/* Os números ficam sempre na base: os cartões da mesma linha alinham-se. */}
                <div className="mt-auto pt-4">
                  <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-caetano-medium-gray-40 pt-3 text-xs text-caetano-anthracite-80">
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <LayoutGrid size={14} aria-hidden="true" className="text-caetano-deep-blue-60" />
                      {workspace._count.campaigns} aplicações
                    </span>
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <Folder size={14} aria-hidden="true" className="text-caetano-deep-blue-60" />
                      {workspace._count.folders} pastas
                    </span>
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        label="Paginação de espaços de trabalho"
        buildHref={(target) => `/workspaces?page=${target}`}
      />

      {canManage && (
        <div className="mt-8 sm:mt-10">
          <BrandFormPanel
            headingId="new-workspace-heading"
            title="Novo espaço de trabalho"
            description="Um espaço por marca, departamento ou cliente, com as suas pastas e aplicações."
            icon={<Building2 size={20} />}
          >
            <form action={createWorkspaceAction} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input
                    id="name"
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="off"
                    aria-invalid={params.error === "validation" || undefined}
                    aria-describedby={params.error === "validation" ? "workspace-name-error" : undefined}
                  />
                  {params.error === "validation" && (
                    <p id="workspace-name-error" className="mt-1 text-xs text-danger-strong">
                      Indique um nome com até 120 caracteres.
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="description">Descrição (opcional)</Label>
                  <Input id="description" name="description" autoComplete="off" />
                </div>
              </div>
              <div className="flex justify-end border-t border-caetano-medium-gray-40 pt-5">
                <SubmitButton pendingLabel="A guardar…" className="w-full sm:w-auto">
                  Criar espaço de trabalho
                </SubmitButton>
              </div>
            </form>
          </BrandFormPanel>
        </div>
      )}
    </div>
  );
}
