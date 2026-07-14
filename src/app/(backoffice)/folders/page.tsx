import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import {
  archiveFolderAction,
  createFolderAction,
  deleteFolderAction,
  renameFolderAction,
  unarchiveFolderAction,
} from "@/features/folders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

const ERROR_MESSAGES: Record<string, string> = {
  folder_not_empty: "Não é possível eliminar: mova ou elimine primeiro as aplicações desta pasta.",
  validation: "Dados inválidos.",
  not_found: "Pasta não encontrada.",
};

export default async function FoldersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; showArchived?: string }>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  const canManage = can(context, "workspace:manage");
  const showArchived = params.showArchived === "1";

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    include: {
      folders: {
        where: showArchived ? {} : { archivedAt: null },
        orderBy: { name: "asc" },
        include: { _count: { select: { campaigns: true } } },
      },
    },
  });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">Pastas</h1>
      <p className="mt-1 text-caetano-medium-gray">
        Organize as aplicações por marca, campanha ou finalidade dentro de cada espaço de trabalho.
      </p>

      {params.error && (
        <div className="mt-4">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      <div className="mt-4">
        <a
          href={`/folders?showArchived=${showArchived ? "0" : "1"}`}
          className="text-sm text-caetano-cyan hover:underline"
        >
          {showArchived ? "Ocultar pastas arquivadas" : "Mostrar pastas arquivadas"}
        </a>
      </div>

      <div className="mt-4 space-y-6">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <h2 className="mb-3 font-semibold text-caetano-anthracite">{workspace.name}</h2>

            {workspace.folders.length === 0 ? (
              <p className="text-sm text-caetano-medium-gray">Sem pastas ainda.</p>
            ) : (
              <ul className="divide-y divide-caetano-medium-gray/20">
                {workspace.folders.map((folder) => (
                  <li key={folder.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="text-sm font-medium text-caetano-anthracite">{folder.name}</span>
                      <span className="ml-2 text-xs text-caetano-medium-gray">
                        {folder._count.campaigns} aplicações
                        {folder.archivedAt ? " · arquivada" : ""}
                      </span>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-2">
                        <details className="relative">
                          <summary className="cursor-pointer list-none text-sm text-caetano-cyan">
                            Renomear
                          </summary>
                          <form
                            action={renameFolderAction}
                            className="absolute right-0 z-10 mt-1 flex w-56 gap-2 rounded-lg border border-caetano-medium-gray/30 bg-white p-2 shadow-lg"
                          >
                            <input type="hidden" name="folderId" value={folder.id} />
                            <Input name="name" defaultValue={folder.name} required className="h-8" />
                            <Button type="submit" size="sm">
                              OK
                            </Button>
                          </form>
                        </details>
                        {folder.archivedAt ? (
                          <form action={unarchiveFolderAction}>
                            <input type="hidden" name="folderId" value={folder.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Restaurar
                            </Button>
                          </form>
                        ) : (
                          <form action={archiveFolderAction}>
                            <input type="hidden" name="folderId" value={folder.id} />
                            <Button type="submit" size="sm" variant="outline">
                              Arquivar
                            </Button>
                          </form>
                        )}
                        <form action={deleteFolderAction}>
                          <input type="hidden" name="folderId" value={folder.id} />
                          <ConfirmSubmitButton
                            confirmMessage={`Eliminar a pasta "${folder.name}"? Só é possível se estiver vazia.`}
                            size="sm"
                          >
                            Eliminar
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {canManage && (
              <form action={createFolderAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="workspaceId" value={workspace.id} />
                <div>
                  <Label htmlFor={`new-folder-${workspace.id}`}>Nova pasta</Label>
                  <Input id={`new-folder-${workspace.id}`} name="name" required className="h-9" />
                </div>
                <Button type="submit" size="sm" variant="outline">
                  Adicionar
                </Button>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
