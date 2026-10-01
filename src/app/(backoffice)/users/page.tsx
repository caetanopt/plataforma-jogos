import { ChevronDown, UserPlus, Users } from "lucide-react";
import { pageParam } from "@/lib/forms/search-params";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { inviteUserAction, removeMembershipAction, updateMembershipAction } from "@/features/users/actions";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { BrandFormPanel } from "@/components/backoffice/admin/brand-form-panel";
import { MemberAvatar } from "@/components/backoffice/admin/member-avatar";
import { RoleBadge } from "@/components/backoffice/admin/role-badge";
import { SectionHeading } from "@/components/backoffice/admin/section-heading";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export const metadata = { title: "Utilizadores" };

/** Uma organização grande fazia esta página carregar todos os membros. */
const PAGE_SIZE = 25;

const ERROR_MESSAGES: Record<string, string> = {
  invite_email_failed: "Não foi possível enviar o e-mail de convite. Nada foi criado — tente novamente.",
  validation: "Verifique os dados do convite.",
  already_member: "Este utilizador já pertence à organização.",
  last_admin: "Tem de existir pelo menos um administrador na organização.",
};

/* A caixa inteira é a área clicável da opção (≥ 40 px), não só o quadrado. */
const checkboxLabelClass =
  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-caetano-anthracite transition-colors duration-200 hover:bg-caetano-medium-gray-20";
const checkboxClass = "h-4 w-4 shrink-0 cursor-pointer rounded accent-caetano-deep-blue";

/** As permissões extra de um membro, uma etiqueta por permissão. */
function ExtraPermissions({ canPublish, canExportLeads }: { canPublish: boolean; canExportLeads: boolean }) {
  const chipClass =
    "inline-flex whitespace-nowrap rounded-md bg-caetano-deep-blue-20 px-2 py-0.5 text-xs font-medium text-caetano-deep-blue";
  return (
    <>
      {canPublish && <span className={chipClass}>Publicar </span>}
      {canExportLeads && <span className={chipClass}>Exportar leads</span>}
    </>
  );
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; page?: string }>;
}) {
  const context = await requirePagePermission("user:manage");
  const search = await searchParams;

  const page = pageParam(search.page);
  const where = { organizationId: context.organizationId };

  const [memberships, total] = await Promise.all([
    prisma.membership.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.membership.count({ where }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Utilizadores"
        description="Convide colegas e defina o papel de cada um na organização."
      />

      {search.error && (
        <div className="mb-6">
          <Alert variant="error">{ERROR_MESSAGES[search.error] ?? "Não foi possível concluir a operação."}</Alert>
        </div>
      )}

      <section aria-labelledby="members-heading">
        <SectionHeading
          id="members-heading"
          icon={<Users size={20} />}
          title="Membros"
          actions={
            <span className="inline-flex h-7 items-center rounded-full bg-white px-3 text-xs font-medium text-caetano-deep-blue tabular-nums ring-1 ring-caetano-medium-gray-40">
              {total === 1 ? "1 membro" : `${total} membros`}
            </span>
          }
        />

        <Card padding="none" className="mt-4 overflow-hidden">
          <div
            tabIndex={0}
            role="region"
            aria-label="Tabela de utilizadores"
            // `relative`: os textos só para leitores de ecrã (sr-only) são
            // absolutos; sem um contentor posicionado, os das colunas que
            // ficam fora do ecrã alargavam a página inteira no telemóvel.
            className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-caetano-cyan"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Utilizadores da organização e respetivos papéis</caption>
              <thead>
                <tr className="border-b border-caetano-medium-gray-40 bg-caetano-medium-gray-20 text-left text-xs uppercase tracking-[0.08em] text-caetano-anthracite-80">
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Nome</th>
                  {/* Em ecrãs mais estreitos o e-mail passa para debaixo do nome (abaixo de 2xl)
                      e as permissões extra para debaixo do papel (abaixo de xl): menos colunas, e
                      a tabela e o painel "Editar" cabem sem deslizar num portátil. */}
                  <th scope="col" className="hidden px-4 py-3 font-medium 2xl:table-cell">E-mail</th>
                  <th scope="col" className="px-4 py-3 font-medium">Papel</th>
                  <th scope="col" className="hidden whitespace-nowrap px-4 py-3 font-medium xl:table-cell">
                    Permissões extra
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-caetano-medium-gray-40">
                {memberships.map((membership) => (
                  // Tudo alinhado ao topo: ao abrir "Editar" a linha cresce para baixo e o
                  // resto da linha fica onde estava. Cada célula tem a altura do avatar.
                  <tr
                    key={membership.id}
                    className="align-top transition-colors duration-200 hover:bg-caetano-medium-gray-20"
                  >
                    <td className="px-4 py-3 sm:px-5">
                      <span className="flex min-h-9 items-center gap-3">
                        <MemberAvatar name={membership.user.name} />
                        <span className="min-w-0">
                          <span className="block min-w-36 font-medium text-caetano-anthracite">
                            {membership.user.name}
                          </span>
                          <span className="block whitespace-nowrap text-xs text-caetano-anthracite-80 2xl:hidden">
                            {membership.user.email}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-caetano-anthracite-80 2xl:table-cell">
                      <span className="flex min-h-9 items-center">{membership.user.email}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex min-h-9 items-center">
                        <RoleBadge role={membership.role} />
                      </span>
                      {(membership.canPublish || membership.canExportLeads) && (
                        <span className="mt-1 flex flex-wrap gap-1.5 xl:hidden">
                          <ExtraPermissions
                            canPublish={membership.canPublish}
                            canExportLeads={membership.canExportLeads}
                          />
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-caetano-anthracite xl:table-cell">
                      {membership.canPublish || membership.canExportLeads ? (
                        <span className="flex min-h-9 flex-wrap items-center gap-1.5">
                          <ExtraPermissions
                            canPublish={membership.canPublish}
                            canExportLeads={membership.canExportLeads}
                          />
                        </span>
                      ) : (
                        <span className="flex min-h-9 items-center">
                          <span aria-hidden="true" className="text-caetano-anthracite-80">
                            —
                          </span>
                          <span className="sr-only">Nenhuma</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 sm:px-5">
                      <details className="group/edit pt-0.5">
                        <summary
                          className={cn(
                            buttonVariants({ variant: "outline", size: "sm" }),
                            "list-none [&::-webkit-details-marker]:hidden group-open/edit:border-caetano-deep-blue-80 group-open/edit:bg-caetano-medium-gray-20",
                          )}
                        >
                          Editar
                          <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className="transition-transform duration-200 ease-(--ease-out-expo) group-open/edit:rotate-180"
                          />
                        </summary>
                        {/*
                          O painel abre para a esquerda, por baixo do papel (a linha cresce,
                          esse espaço fica vazio): com a margem negativa só conta ~96 px para a
                          largura da coluna, e a tabela não passa a deslizar ao editar.
                        */}
                        <div className="relative mt-2 -ml-48 w-72 origin-top-right rounded-xl border border-caetano-medium-gray-40 bg-white p-3 shadow-md motion-safe:animate-scale-in">
                          <form action={updateMembershipAction} className="space-y-2">
                            <input type="hidden" name="membershipId" value={membership.id} />
                            {/* O nome acessível começa pelo texto visível e diz de quem é (WCAG 2.5.3). */}
                            <Label htmlFor={`membership-${membership.id}-role`} className="mb-1 text-xs">
                              Papel
                            </Label>
                            <Select
                              id={`membership-${membership.id}-role`}
                              name="role"
                              defaultValue={membership.role}
                              aria-label={`Papel de ${membership.user.name}`}
                              className="h-9"
                            >
                              {Object.entries(MEMBERSHIP_ROLE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </Select>
                            <div>
                              <label className={checkboxLabelClass}>
                                <input
                                  type="checkbox"
                                  name="canPublish"
                                  defaultChecked={membership.canPublish}
                                  className={checkboxClass}
                                />
                                Pode publicar (Editor)
                              </label>
                              <label className={checkboxLabelClass}>
                                <input
                                  type="checkbox"
                                  name="canExportLeads"
                                  defaultChecked={membership.canExportLeads}
                                  className={checkboxClass}
                                />
                                Pode exportar leads (Analista)
                              </label>
                            </div>
                            <SubmitButton pendingLabel="A guardar…" size="sm" className="w-full">
                              Guardar
                            </SubmitButton>
                          </form>
                          <form
                            action={removeMembershipAction}
                            className="mt-3 border-t border-caetano-medium-gray-40 pt-3"
                          >
                            <input type="hidden" name="membershipId" value={membership.id} />
                            <ConfirmSubmitButton
                              confirmMessage={`Remover ${membership.user.name} da organização?`}
                              size="sm"
                              variant="ghost"
                              className="w-full text-danger-strong hover:bg-danger-surface active:bg-danger-surface"
                            >
                              Remover
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          label="Paginação de utilizadores"
          buildHref={(target) => `/users?page=${target}`}
        />
      </section>

      {can(context, "user:manage") && (
        <div className="mt-8 sm:mt-10">
          <BrandFormPanel
            headingId="invite-heading"
            title="Convidar utilizador"
            description="Escolha o papel e as permissões extra antes de enviar o convite por e-mail."
            icon={<UserPlus size={20} />}
          >
            <form action={inviteUserAction} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="name">Nome</Label>
                  <Input id="name" name="name" required autoComplete="off" />
                </div>
                <div>
                  <Label htmlFor="email">E-mail</Label>
                  <Input id="email" name="email" type="email" required autoComplete="off" />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <Label htmlFor="role">Papel</Label>
                  <Select id="role" name="role" defaultValue="VIEWER">
                    {Object.entries(MEMBERSHIP_ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-caetano-anthracite">Permissões extra</legend>
                <div className="-mx-2 grid sm:grid-cols-2">
                  <label className={checkboxLabelClass}>
                    <input type="checkbox" name="canPublish" className={checkboxClass} />
                    Pode publicar (aplica-se ao papel Editor)
                  </label>
                  <label className={checkboxLabelClass}>
                    <input type="checkbox" name="canExportLeads" className={checkboxClass} />
                    Pode exportar leads (aplica-se ao papel Analista)
                  </label>
                </div>
              </fieldset>
              <div className="flex justify-end border-t border-caetano-medium-gray-40 pt-5">
                <SubmitButton pendingLabel="A guardar…" className="w-full sm:w-auto">
                  <UserPlus size={16} aria-hidden="true" />
                  Enviar convite
                </SubmitButton>
              </div>
            </form>
          </BrandFormPanel>
        </div>
      )}
    </div>
  );
}
