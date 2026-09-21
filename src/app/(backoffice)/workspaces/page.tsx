import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { createWorkspaceAction, renameWorkspaceAction } from "@/features/workspaces/actions";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";

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
  const context = await requireOrgContext();
  const canManage = can(context, "workspace:manage");

  const page = Math.max(1, Number(params.page ?? 1) || 1);
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
    <div className="p-8">
      <h1 className="text-2xl font-bold text-caetano-anthracite">Espaços de trabalho</h1>
      <p className="mt-1 text-caetano-anthracite-80">
        Agrupam campanhas, utilizadores e permissões por marca, departamento ou cliente.
      </p>

      {params.error && (
        <div className="mt-4">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      {workspaces.length === 0 ? (
        <div className="mt-6 rounded-xl border border-caetano-medium-gray-40 bg-white p-10 text-center text-caetano-anthracite-80">
          Ainda não existe nenhum espaço de trabalho.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-caetano-anthracite">{workspace.name}</p>
                  {workspace.description && (
                    <p className="text-sm text-caetano-anthracite-80">{workspace.description}</p>
                  )}
                  <p className="mt-1 text-xs text-caetano-anthracite-80">
                    {workspace._count.campaigns} aplicações · {workspace._count.folders} pastas
                  </p>
                </div>
              </div>

              {canManage && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-caetano-deep-blue list-none select-none rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan">Editar</summary>
                  <form action={renameWorkspaceAction} className="mt-2 space-y-2">
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <Input name="name" defaultValue={workspace.name} required />
                    <Input
                      name="description"
                      defaultValue={workspace.description ?? ""}
                      placeholder="Descrição (opcional)"
                    />
                    <SubmitButton pendingLabel="A guardar…" size="sm" variant="outline">
                      Guardar
                    </SubmitButton>
                  </form>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        label="Paginação de espaços de trabalho"
        buildHref={(target) => `/workspaces?page=${target}`}
      />

      {canManage && (
        <div className="mt-8 max-w-md rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-caetano-anthracite">
            Novo espaço de trabalho
          </h2>
          <form action={createWorkspaceAction} className="space-y-3">
            <div>
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={120}
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
              <Input id="description" name="description" />
            </div>
            <SubmitButton pendingLabel="A guardar…">Criar espaço de trabalho</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
