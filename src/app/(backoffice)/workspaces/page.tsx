import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { createWorkspaceAction, renameWorkspaceAction } from "@/features/workspaces/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function WorkspacesPage() {
  const context = await requireOrgContext();
  const canManage = can(context, "workspace:manage");

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    include: { _count: { select: { campaigns: true, folders: true } } },
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">Espaços de trabalho</h1>
      <p className="mt-1 text-caetano-medium-gray">
        Agrupam campanhas, utilizadores e permissões por marca, departamento ou cliente.
      </p>

      {workspaces.length === 0 ? (
        <div className="mt-6 rounded-xl border border-caetano-medium-gray/30 bg-white p-10 text-center text-caetano-medium-gray">
          Ainda não existe nenhum espaço de trabalho.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-caetano-anthracite">{workspace.name}</p>
                  {workspace.description && (
                    <p className="text-sm text-caetano-medium-gray">{workspace.description}</p>
                  )}
                  <p className="mt-1 text-xs text-caetano-medium-gray">
                    {workspace._count.campaigns} aplicações · {workspace._count.folders} pastas
                  </p>
                </div>
              </div>

              {canManage && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-caetano-cyan">Editar</summary>
                  <form action={renameWorkspaceAction} className="mt-2 space-y-2">
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <Input name="name" defaultValue={workspace.name} required />
                    <Input
                      name="description"
                      defaultValue={workspace.description ?? ""}
                      placeholder="Descrição (opcional)"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Guardar
                    </Button>
                  </form>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <div className="mt-8 max-w-md rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">
            Novo espaço de trabalho
          </h2>
          <form action={createWorkspaceAction} className="space-y-3">
            <div>
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" required />
            </div>
            <div>
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Input id="description" name="description" />
            </div>
            <Button type="submit">Criar espaço de trabalho</Button>
          </form>
        </div>
      )}
    </div>
  );
}
