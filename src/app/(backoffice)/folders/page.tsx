import Link from "next/link";
import { Archive, FolderOpen, FolderPlus, Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { FolderCard } from "@/components/backoffice/folder-card";
import { Select } from "@/components/ui/select";

export const metadata = { title: "Início" };

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

/**
 * Data de hoje para o cabeçalho ("Quinta-feira, 1 de outubro"), no mesmo fuso
 * da saudação (ver lib/dates/greeting.ts): calculada no servidor, sem
 * diferenças de hidratação.
 */
function formatToday(now: Date): string {
  const label = new Intl.DateTimeFormat("pt-PT", {
    timeZone: "Europe/Lisbon",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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

  const now = new Date();
  const greetingName = getGreetingName(context.userName);

  return (
    <div className="p-4 sm:p-6 md:p-8">
      {/*
        Cabeçalho de marca: o azul profundo com a luz do azul cyan, como as
        aplicações digitais do Brand Book. A luz fica do lado direito, longe
        do texto, para o contraste do branco não depender da animação.
      */}
      <header className="surface-brand relative isolate overflow-hidden rounded-3xl px-5 py-7 shadow-lg sm:px-8 sm:py-9 lg:px-10 lg:py-11">
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
          {/* Em ecrãs estreitos o texto ocupa a largura toda: sem a luz extra por trás. */}
          <div className="absolute inset-y-0 right-0 hidden w-3/5 sm:block">
            <div className="brand-aurora" />
          </div>
          {/* Traços de velocidade junto à base, abaixo das linhas de texto. */}
          <span className="brand-streak top-[88%]" />
          <span className="brand-streak top-[94%] [animation-delay:3.2s] [animation-duration:9s]" />
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-white sm:text-caetano-cyan-20">
              {formatToday(now)}
            </p>
            <h1 className="mt-2 text-[1.75rem] font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]">
              {getGreeting(now)}
              {greetingName ? `, ${greetingName}` : ""} <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-2 max-w-xl text-base font-light text-caetano-cyan-20 sm:text-lg">
              As suas pastas e aplicações, prontas para a próxima campanha.
            </p>
          </div>
          {can(context, "campaign:create") && (
            <Link href="/apps/new" className={buttonVariants({ variant: "inverse", size: "lg", className: "shrink-0" })}>
              <Plus size={18} aria-hidden="true" />
              Criar aplicação
            </Link>
          )}
        </div>
      </header>

      {params.error && (
        <div className="mt-6">
          <Alert variant="error">{ERROR_MESSAGES[params.error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      {!params.error && params.ok && SUCCESS_MESSAGES[params.ok] && (
        <div className="mt-6">
          <Alert variant="success">{SUCCESS_MESSAGES[params.ok]}</Alert>
        </div>
      )}

      <section aria-labelledby="minhas-pastas" className="mt-8 sm:mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="minhas-pastas" className="text-base font-bold text-caetano-deep-blue sm:text-lg">
            Minhas pastas
          </h2>

          {canManage &&
            (workspaces.length === 0 ? (
              <Link href="/workspaces" className={buttonVariants({ variant: "outline" })}>
                Criar espaço de trabalho
              </Link>
            ) : (
              <details className="relative">
                <summary
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "list-none [&::-webkit-details-marker]:hidden [[open]>&]:border-caetano-deep-blue-80 [[open]>&]:bg-caetano-medium-gray-20",
                  )}
                >
                  <FolderPlus size={16} aria-hidden="true" />
                  Nova pasta
                </summary>
                <form
                  action={createFolderAction}
                  className="absolute right-0 z-20 mt-2 w-72 origin-top-right space-y-3 rounded-2xl border border-caetano-medium-gray-40 bg-white p-4 text-left shadow-lg motion-safe:animate-scale-in"
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
                    <Select
                      id="new-folder-workspace"
                      name="workspaceId"
                      required
                      defaultValue={workspaces[0].id}
                    >
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button type="submit" className="w-full">
                    Criar pasta
                  </Button>
                </form>
              </details>
            ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:border-b sm:border-caetano-medium-gray-40">
          <nav
            aria-label="Filtrar pastas"
            className="flex gap-1 border-b border-caetano-medium-gray-40 sm:border-b-0"
          >
            {FOLDER_TABS.map((key) => {
              const isActive = key === tab;
              return (
                <Link
                  key={key}
                  href={foldersUrl({ tab: key, sort })}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex h-11 items-center gap-2 rounded-t-lg border-b-2 px-3 text-sm font-medium",
                    "transition-[border-color,color,background-color] duration-200 ease-(--ease-out-expo)",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-caetano-cyan",
                    isActive
                      ? "border-caetano-deep-blue text-caetano-deep-blue"
                      : "border-transparent text-caetano-anthracite-80 hover:border-caetano-medium-gray-60 hover:text-caetano-anthracite",
                  )}
                >
                  {FOLDER_TAB_LABELS[key]}
                  {key === "arquivadas" && archivedCount > 0 ? (
                    <>
                      {" "}
                      {/* O número continua a ler-se "Arquivadas (1)"; os parênteses ficam só para leitores de ecrã. */}
                      <span
                        className={cn(
                          "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none tabular-nums",
                          isActive
                            ? "bg-caetano-deep-blue text-white"
                            : "bg-caetano-medium-gray-40 text-caetano-anthracite",
                        )}
                      >
                        <span className="sr-only">(</span>
                        {archivedCount}
                        <span className="sr-only">)</span>
                      </span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          {/* Ordenação sem JavaScript: GET normal submetido pelo botão. */}
          <form method="get" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap sm:pb-2">
            <input type="hidden" name="tab" value={tab} />
            {/* Num ecrã de 320 px a etiqueta passa para cima: o select fica com espaço para o valor. */}
            <Label
              htmlFor="folder-sort"
              className="mb-0 whitespace-nowrap text-xs text-caetano-anthracite-80 max-[379px]:basis-full"
            >
              Ordenar por
            </Label>
            <Select
              id="folder-sort"
              name="sort"
              defaultValue={sort}
              wrapperClassName="min-w-0 flex-1 sm:w-48 sm:flex-none"
            >
              {FOLDER_SORTS.map((key) => (
                <option key={key} value={key}>
                  {FOLDER_SORT_LABELS[key]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline" className="shrink-0">
              Aplicar
            </Button>
          </form>
        </div>

        {folders.length === 0 ? (
          <Card
            padding="none"
            className="mt-6 border-dashed border-caetano-medium-gray-60 bg-[radial-gradient(70%_90%_at_50%_0%,var(--color-caetano-cyan-20),var(--color-caetano-ultra-white)_70%)]"
          >
            {tab === "arquivadas" ? (
              <EmptyState
                icon={<Archive size={24} />}
                title="Não há pastas arquivadas"
                description="As pastas que arquivar aparecem aqui e podem ser restauradas a qualquer momento."
              />
            ) : (
              <EmptyState
                icon={<FolderOpen size={24} />}
                title="Ainda não há pastas"
                description={
                  canManage
                    ? "As pastas agrupam as aplicações por marca, campanha ou finalidade."
                    : "Quando um administrador criar pastas, elas aparecem aqui."
                }
                action={
                  canManage && workspaces.length > 0 ? (
                    <Link href="/apps/new" className={buttonVariants()}>
                      <Plus size={16} aria-hidden="true" />
                      Criar a primeira aplicação
                    </Link>
                  ) : undefined
                }
              />
            )}
          </Card>
        ) : (
          <ul className="stagger mt-6 grid gap-x-5 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => (
              // O menu aberto de uma pasta passa por cima das pastas seguintes.
              <li key={folder.id} className="relative has-[details[open]]:z-30">
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
