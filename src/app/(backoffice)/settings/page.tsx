import { Clock, Filter, History, ShieldCheck } from "lucide-react";
import { pageParam } from "@/lib/forms/search-params";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { updatePrivacySettingsAction } from "@/features/organizations/actions";
import { updateOrganizationRetentionAction } from "@/features/privacy/actions";
import { lastRetentionRun } from "@/features/privacy/retention-job";
import { retentionJobStatus, retentionOutlook } from "@/features/privacy/retention-queries";
import {
  describeRetention,
  effectiveRetention,
  RETENTION_DAY_OPTIONS,
  RETENTION_WARNING_DAYS,
} from "@/features/privacy/retention-policy";
import { Alert } from "@/components/ui/alert";
import { ORGANIZATION_LIMITS } from "@/lib/validation/organization";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { SectionHeading } from "@/components/backoffice/admin/section-heading";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
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

  const page = pageParam(params.page);
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
  const canManagePrivacy = can(context, "privacy:manage");
  const organization = canManageOrganization
    ? await prisma.organization.findUnique({
        where: { id: context.organizationId },
        select: { privacyContactEmail: true, dataRetentionDays: true, dataRetentionChangedAt: true, defaultTimezone: true },
      })
    : null;
  // A tarefa diária aplica os prazos: se deixou de correr, os dados ficam
  // para lá do prazo sem ninguém dar por isso.
  // Sinal fiável: leads que passaram o prazo há mais de dois dias e ainda
  // têm os dados; ou uma última execução antiga.
  const [lastRun, outlook] = organization
    ? await Promise.all([lastRetentionRun(), retentionOutlook(context.organizationId)])
    : [null, []];
  const overdue = outlook.reduce((sum, campaign) => sum + campaign.overdue, 0);
  const jobStatus = retentionJobStatus(outlook, lastRun);

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Configurações"
        description="Privacidade, conservação dos dados e registo de auditoria da organização."
      />

      {organization && (
        <section aria-labelledby="privacy-heading" className="mb-8 sm:mb-10">
          <SectionHeading
            id="privacy-heading"
            icon={<ShieldCheck size={20} />}
            title="Privacidade"
            description="O contacto que os participantes veem e o prazo de conservação das leads (RGPD)."
          />

          <Card padding="none" className="mt-4 overflow-hidden">
            <div
              className={cn(
                "grid divide-y divide-caetano-medium-gray-40",
                canManagePrivacy && "lg:grid-cols-2 lg:divide-x lg:divide-y-0",
              )}
            >
              <AutoSaveForm action={updatePrivacySettingsAction} className="space-y-1 p-5 sm:p-6">
                <Label htmlFor="privacyContactEmail">Contacto de privacidade (e-mail)</Label>
                <Input
                  id="privacyContactEmail"
                  name="privacyContactEmail"
                  type="email"
                  autoComplete="off"
                  maxLength={ORGANIZATION_LIMITS.privacyContactEmail}
                  defaultValue={organization.privacyContactEmail ?? ""}
                  aria-describedby="privacyContactEmail-help"
                  className="max-w-md"
                />
                <p id="privacyContactEmail-help" className="pt-1 text-xs leading-relaxed text-caetano-anthracite-80">
                  Aparece no jogo, junto ao formulário de leads e no rodapé, para os participantes pedirem acesso,
                  correção ou eliminação dos seus dados (RGPD).
                </p>
              </AutoSaveForm>

              {canManagePrivacy && (
                <AutoSaveForm action={updateOrganizationRetentionAction} className="space-y-1 p-5 sm:p-6">
                  <Label htmlFor="dataRetentionDays">Prazo de conservação das leads</Label>
                  <Select
                    id="dataRetentionDays"
                    name="dataRetentionDays"
                    defaultValue={organization.dataRetentionDays ? String(organization.dataRetentionDays) : ""}
                    aria-describedby="dataRetentionDays-help"
                    wrapperClassName="max-w-sm"
                  >
                    <option value="">Sem prazo (anonimização só à mão)</option>
                    {RETENTION_DAY_OPTIONS.map((days) => (
                      <option key={days} value={days}>
                        {days} dias
                      </option>
                    ))}
                  </Select>
                  <p className="pt-2">
                    <span className="inline-flex flex-wrap items-baseline gap-x-1 rounded-lg bg-caetano-cyan-20 px-2.5 py-1.5 text-xs text-caetano-deep-blue ring-1 ring-caetano-cyan-40">
                      <span className="font-bold">Em vigor:</span>{" "}
                      {describeRetention(
                        effectiveRetention({
                          campaign: { dataRetentionDays: null, dataRetentionUntil: null },
                          organizationDays: organization.dataRetentionDays,
                          organizationChangedAt: organization.dataRetentionChangedAt,
                        }),
                        organization.defaultTimezone,
                      )}
                    </span>
                  </p>
                  <p id="dataRetentionDays-help" className="pt-1 text-xs leading-relaxed text-caetano-anthracite-80">
                    Contado a partir de cada participação. Ao fim do prazo, os dados pessoais (nome, e-mail, telefone,
                    respostas ao formulário, IP) são anonimizados; ficam o resultado, o prémio e as estatísticas. Vale
                    para as campanhas sem prazo próprio (etapa Formulário de leads). Um prazo novo ou alterado só
                    começa a anonimizar {RETENTION_WARNING_DAYS} dias depois, e a lista de leads avisa com{" "}
                    {RETENTION_WARNING_DAYS} dias de antecedência.
                  </p>
                </AutoSaveForm>
              )}
            </div>

            {canManagePrivacy && (
              <div className="space-y-3 border-t border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-5 py-4 sm:px-6">
                <p className="flex items-start gap-2.5 text-xs text-caetano-anthracite">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      jobStatus === "ok"
                        ? "bg-caetano-eco-green-20 text-caetano-anthracite ring-1 ring-caetano-eco-green-40"
                        : "bg-caetano-dynamic-orange-20 text-caetano-anthracite ring-1 ring-caetano-dynamic-orange-40",
                    )}
                  >
                    <Clock size={12} />
                  </span>
                  <span className="pt-0.5">
                    Tarefa diária de anonimização:{" "}
                    {lastRun
                      ? `última execução a ${lastRun.at.toLocaleString("pt-PT", { timeZone: organization.defaultTimezone })}.`
                      : "ainda não correu."}
                  </span>
                </p>
                {jobStatus !== "ok" && (
                  <Alert variant="warning" live={false}>
                    {jobStatus === "stopped" ? (
                      <>
                        A tarefa diária que aplica os prazos de conservação não está a correr
                        {overdue > 0
                          ? ` (${overdue === 1 ? "1 lead passou" : `${overdue} leads passaram`} o prazo há mais de dois dias)`
                          : ""}
                        : as leads ficam guardadas para lá do prazo. Peça a quem gere o alojamento para confirmar a
                        tarefa agendada e a variável CRON_SECRET (ver o README).
                      </>
                    ) : (
                      <>
                        A tarefa diária corre, mas ainda não chegou a todas as leads fora do prazo ({overdue}): muitas de
                        uma vez, ou em uso. O resto sai nas próximas execuções.
                      </>
                    )}
                  </Alert>
                )}
              </div>
            )}
          </Card>
        </section>
      )}

      <section aria-labelledby="audit-heading">
        <SectionHeading
          id="audit-heading"
          icon={<History size={20} />}
          title="Auditoria"
          description={`Ações relevantes ${context.isSuperAdmin ? "em todas as organizações" : "nesta organização"}.`}
        />

        <Card padding="none" className="mt-4 overflow-hidden">
          <form
            method="get"
            className="flex flex-col gap-3 border-b border-caetano-medium-gray-40 bg-caetano-medium-gray-20 p-4 sm:flex-row sm:flex-wrap sm:items-end sm:px-5"
          >
            <div className="sm:w-60">
              <Label htmlFor="action">Ação</Label>
              <Select id="action" name="action" defaultValue={params.action ?? ""}>
                <option value="">Todas</option>
                {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:w-60">
              <Label htmlFor="entityType">Entidade</Label>
              <Select id="entityType" name="entityType" defaultValue={params.entityType ?? ""}>
                <option value="">Todas</option>
                {entityTypes.map((e) => (
                  <option key={e.entityType} value={e.entityType}>
                    {e.entityType}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" className="sm:w-auto">
              <Filter size={16} aria-hidden="true" />
              Aplicar filtros
            </Button>
          </form>

          <div
            tabIndex={0}
            role="region"
            aria-label="Tabela de auditoria"
            // `relative`: contém os textos sr-only (absolutos) das colunas fora
            // do ecrã, que sem isto alargavam a página no telemóvel.
            className="relative overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-caetano-cyan"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Registo de auditoria</caption>
              <thead>
                <tr className="border-b border-caetano-medium-gray-40 text-left text-xs uppercase tracking-[0.08em] text-caetano-anthracite-80">
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Data</th>
                  <th scope="col" className="px-4 py-3 font-medium">Utilizador</th>
                  <th scope="col" className="px-4 py-3 font-medium">Ação</th>
                  <th scope="col" className="px-4 py-3 font-medium">Entidade</th>
                  <th scope="col" className="px-4 py-3 font-medium sm:px-5">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-caetano-medium-gray-40">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-caetano-anthracite-80">
                      <span
                        aria-hidden="true"
                        className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-caetano-cyan-20 text-caetano-deep-blue"
                      >
                        <History size={22} />
                      </span>
                      Nenhum registo de auditoria para os filtros atuais.
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.id} className="transition-colors duration-200 hover:bg-caetano-medium-gray-20">
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-caetano-anthracite-80 sm:px-5">
                        {entry.createdAt.toLocaleString("pt-PT")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-caetano-anthracite">
                        {entry.user?.name ?? <span className="text-caetano-anthracite-80">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-caetano-anthracite">
                        {AUDIT_ACTION_LABELS[entry.action]}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-caetano-anthracite-80">
                        {entry.entityType}
                        {entry.entityId && (
                          <span className="ml-1.5 rounded-md bg-caetano-medium-gray-20 px-1.5 py-0.5 font-mono text-xs text-caetano-anthracite ring-1 ring-caetano-medium-gray-40">
                            {/* Os parênteses continuam no texto lido; o chip já os mostra. */}
                            <span className="sr-only">(</span>
                            {entry.entityId.slice(0, 8)}
                            <span className="sr-only">)</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 sm:px-5">
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
        </Card>

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
      </section>
    </div>
  );
}
