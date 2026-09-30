import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { updatePrivacySettingsAction } from "@/features/organizations/actions";
import { ORGANIZATION_LIMITS } from "@/lib/validation/organization";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import type { AuditAction } from "@/generated/prisma/client";

export const metadata = { title: "Configurações" };

interface SettingsSearchParams {
  action?: string;
  entityType?: string;
  page?: string;
}

const PAGE_SIZE = 30;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<SettingsSearchParams>;
}) {
  const params = await searchParams;
  const context = await requirePagePermission("audit:view");

  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const action =
    params.action && params.action in AUDIT_ACTION_LABELS ? (params.action as AuditAction) : undefined;

  const where = {
    ...(context.isSuperAdmin ? {} : { organizationId: context.organizationId }),
    ...(action ? { action } : {}),
    ...(params.entityType ? { entityType: params.entityType } : {}),
  };

  const [entries, total, entityTypes] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
    // GROUP BY na base de dados: o `distinct` do Prisma lia todas as linhas
    // da auditoria e tirava os repetidos em memória.
    prisma.auditLog.groupBy({
      by: ["entityType"],
      where: context.isSuperAdmin ? {} : { organizationId: context.organizationId },
      orderBy: { entityType: "asc" },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canManageOrganization = can(context, "organization:manage");
  const organization = canManageOrganization
    ? await prisma.organization.findUnique({
        where: { id: context.organizationId },
        select: { privacyContactEmail: true },
      })
    : null;

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <h1 className="text-2xl font-bold text-caetano-anthracite">Configurações</h1>

      {organization && (
        <section
          aria-labelledby="privacy-heading"
          className="mt-6 max-w-2xl rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
        >
          <h2 id="privacy-heading" className="text-lg font-bold text-caetano-anthracite">
            Privacidade
          </h2>
          <AutoSaveForm action={updatePrivacySettingsAction} className="mt-3 space-y-1">
            <Label htmlFor="privacyContactEmail">Contacto de privacidade (e-mail)</Label>
            <Input
              id="privacyContactEmail"
              name="privacyContactEmail"
              type="email"
              autoComplete="off"
              maxLength={ORGANIZATION_LIMITS.privacyContactEmail}
              defaultValue={organization.privacyContactEmail ?? ""}
              aria-describedby="privacyContactEmail-help"
            />
            <p id="privacyContactEmail-help" className="text-xs text-caetano-anthracite-80">
              Aparece no jogo, junto ao formulário de leads e no rodapé, para os participantes pedirem acesso,
              correção ou eliminação dos seus dados (RGPD).
            </p>
          </AutoSaveForm>
        </section>
      )}

      <h2 className="mt-8 text-lg font-bold text-caetano-anthracite">Auditoria</h2>
      <p className="mt-1 text-caetano-anthracite-80">
        Ações relevantes {context.isSuperAdmin ? "em todas as organizações" : "nesta organização"}.
      </p>

      <form method="get" className="mt-4 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <div>
          <Label htmlFor="action">Ação</Label>
          <select id="action" name="action" defaultValue={params.action ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todas</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="entityType">Entidade</Label>
          <select id="entityType" name="entityType" defaultValue={params.entityType ?? ""} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Todas</option>
            {entityTypes.map((e) => (
              <option key={e.entityType} value={e.entityType}>
                {e.entityType}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      <div
        tabIndex={0}
        role="region"
        aria-label="Tabela de auditoria"
        className="overflow-x-auto rounded-xl border border-caetano-medium-gray-40 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Registo de auditoria</caption>
          <thead>
            <tr className="border-b border-caetano-medium-gray-20 text-left text-xs uppercase text-caetano-anthracite-80">
              <th scope="col" className="px-4 py-3">Data</th>
              <th scope="col" className="px-4 py-3">Utilizador</th>
              <th scope="col" className="px-4 py-3">Ação</th>
              <th scope="col" className="px-4 py-3">Entidade</th>
              <th scope="col" className="px-4 py-3">Resultado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-caetano-medium-gray-20">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-caetano-anthracite-80">
                  Nenhum registo de auditoria para os filtros atuais.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-caetano-anthracite-80">
                    {entry.createdAt.toLocaleString("pt-PT")}
                  </td>
                  <td className="px-4 py-3">{entry.user?.name ?? "—"}</td>
                  <td className="px-4 py-3">{AUDIT_ACTION_LABELS[entry.action]}</td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {entry.entityType}
                    {entry.entityId && <span className="ml-1 font-mono text-xs">({entry.entityId.slice(0, 8)})</span>}
                  </td>
                  <td className="px-4 py-3">
                    {/* O verde eco sobre branco dá 2,57:1; o Badge resolve o
                        contraste e comunica o mesmo. */}
                    <Badge tone={entry.result === "SUCCESS" ? "success" : "danger"}>{entry.result}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        label="Paginação da auditoria"
        buildHref={(target) =>
          `/settings?${new URLSearchParams({
            ...(params.action ? { action: params.action } : {}),
            ...(params.entityType ? { entityType: params.entityType } : {}),
            page: String(target),
          }).toString()}`
        }
      />
    </div>
  );
}
