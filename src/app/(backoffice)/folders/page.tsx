import Link from "next/link";
import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { createFolderAction } from "@/features/folders/actions";
import {
  FOLDER_SORTS,
  FOLDER_SORT_LABELS,
  FOLDER_SORT_ORDER_BY,
  FOLDER_TABS,
  FOLDER_TAB_LABELS,
  foldersUrl,
  parseFolderSort,
  parseFolderTab,
} from "@/features/folders/view-params";
import { getGreeting, getGreetingName } from "@/lib/dates/greeting";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { FolderCard } from "@/components/backoffice/folder-card";

const ERROR_MESSAGES: Record<string, string> = {
  folder_not_empty: "Não é possível eliminar: mova ou elimine primeiro as aplicações desta pasta.",
  validation: "Dados inválidos. Confirme o nome da pasta (até 120 caracteres).",
  not_found: "Pasta não encontrada.",
};

/* Uma ação sem confirmação deixa o utilizador sem saber se resultou. */
const SUCCESS_MESSAGES: Record<string, string> = {
  created: "Pasta criada.",
  renamed: "Pasta renomeada.",
  archived: "Pasta arquivada.",
  restored: "Pasta restaurada.",
  deleted: "Pasta eliminada.",
};

const selectClass =
  "h-10 w-full rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm focus-visible:border-caetano-cyan focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:outline-none";

interface HomeSearchParams {
  error?: string;
  ok?: string;
  tab?: string;
  sort?: string;
}

export default async function FoldersPage({
  searchParams,
}: {
  searchParams: Promise<HomeSearchParams>;
}) {
  const params = await searchParams;
  const context = await requireOrgContext();
  const canManage = can(context, "workspace:manage");

  const tab = parseFolderTab(params.tab);
  const sort = parseFolderSort(params.sort);

  const [folders, archivedCount, workspaces] = await Promise.all([
    prisma.folder.findMany({
      // Folder não tem organizationId próprio: o isolamento multi-tenant
      // faz-se sempre pela travessia da relação até ao workspace.
      where: {
        workspace: { organizationId: context.organizationId },
        archivedAt: tab === "arquivadas" ? { not: null } : null,
      },
      orderBy: FOLDER_SORT_ORDER_BY[sort],
      include: {
        workspace: { select: { name: true } },
        _count: { select: { campaigns: true } },
      },
    }),
    prisma.folder.count({
      where: {
        workspace: { organizationId: context.organizationId },
        archivedAt: { not: null },
      },
    }),
    prisma.workspace.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const greetingName = getGreetingName(context.userName);

  return (
    <div className="p-6 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-caetano-anthracite">
          {getGreeting(new Date())}
          {greetingName ? `, ${greetingName}` : ""} <span aria-hidden="true">👋</span>
        </h1>
        <Link href="/apps/new" className={buttonVariants()}>
          Criar aplicação
        </Link>
      </header>

      {params.error && (
        <div className="mt-4">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      {!params.error && params.ok && SUCCESS_MESSAGES[params.ok] && (
        <div className="mt-4">
          <Alert variant="success">{SUCCESS_MESSAGES[params.ok]}</Alert>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-caetano-medium-gray-40 bg-white p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-caetano-anthracite">Minhas pastas</h2>

          {canManage &&
            (workspaces.length === 0 ? (
              <Link href="/workspaces" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Criar espaço de trabalho
              </Link>
            ) : (
              <details className="relative">
                <summary className={`${buttonVariants({ size: "sm" })} cursor-pointer list-none`}>
                  + Nova pasta
                </summary>
                <form
                  action={createFolderAction}
                  className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-lg border border-caetano-medium-gray-40 bg-white p-4 text-left shadow-lg"
                >
                  <input type="hidden" name="tab" value={tab} />
                  <input type="hidden" name="sort" value={sort} />
                  <div>
                    <Label htmlFor="new-folder-name">Nome da pasta</Label>
                    <Input
                      id="new-folder-name"
                      name="name"
                      required
                      maxLength={120}
                      autoComplete="off"
                      // O erro de validação destas ações é sempre sobre o nome:
                      // marcá-lo diz ao leitor de ecrã qual é o campo em falta.
                      aria-invalid={params.error === "validation" || undefined}
                      aria-describedby={params.error === "validation" ? "new-folder-error" : undefined}
                    />
                    {params.error === "validation" && (
                      <p id="new-folder-error" className="mt-1 text-xs text-danger-strong">
                        Indique um nome com até 120 caracteres.
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="new-folder-workspace">Espaço de trabalho</Label>
                    <select
                      id="new-folder-workspace"
                      name="workspaceId"
                      required
                      defaultValue={workspaces[0].id}
                      className={selectClass}
                    >
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" size="sm" className="w-full">
                    Criar pasta
                  </Button>
                </form>
              </details>
            ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-b border-caetano-medium-gray-40">
          <nav aria-label="Filtrar pastas" className="flex gap-1">
            {FOLDER_TABS.map((key) => {
              const isActive = key === tab;
              return (
                <Link
                  key={key}
                  href={foldersUrl({ tab: key, sort })}
                  aria-current={isActive ? "page" : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-caetano-cyan text-caetano-deep-blue"
                      : "border-transparent text-caetano-anthracite-80 hover:text-caetano-anthracite"
                  }`}
                >
                  {FOLDER_TAB_LABELS[key]}
                  {key === "arquivadas" && archivedCount > 0 ? ` (${archivedCount})` : ""}
                </Link>
              );
            })}
          </nav>

          {/* Ordenação sem JavaScript: GET normal submetido pelo botão. */}
          <form method="get" className="flex items-center gap-2 pb-2">
            <input type="hidden" name="tab" value={tab} />
            <Label htmlFor="folder-sort" className="mb-0 whitespace-nowrap text-xs text-caetano-anthracite-80">
              Ordenar por
            </Label>
            <select id="folder-sort" name="sort" defaultValue={sort} className={`${selectClass} h-8 w-auto`}>
              {FOLDER_SORTS.map((key) => (
                <option key={key} value={key}>
                  {FOLDER_SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline">
              Aplicar
            </Button>
          </form>
        </div>

        {folders.length === 0 ? (
          <p className="py-12 text-center text-sm text-caetano-anthracite-80">
            {tab === "arquivadas"
              ? "Não há pastas arquivadas."
              : canManage
                ? "Ainda não há pastas. Crie a primeira para organizar as suas aplicações."
                : "Ainda não há pastas neste espaço."}
          </p>
        ) : (
          <ul className="mt-6 grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => (
              <li key={folder.id}>
                <FolderCard
                  id={folder.id}
                  name={folder.name}
                  workspaceName={folder.workspace.name}
                  campaignCount={folder._count.campaigns}
                  isArchived={folder.archivedAt !== null}
                  canManage={canManage}
                  tab={tab}
                  sort={sort}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
