import Link from "next/link";
import { requirePagePermission } from "@/server/auth/page-guard";
import { firstValues } from "@/lib/forms/search-params";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { countLeadsToAnonymize, listLeads } from "@/features/leads/queries";
import { leadsFiltersFromParams, leadsFiltersToParams } from "@/features/leads/filters";
import { toLeadRow } from "@/features/leads/format";
import { anonymizeLeadsAction } from "@/features/privacy/actions";
import { retentionOutlook } from "@/features/privacy/retention-queries";
import { RETENTION_WARNING_DAYS } from "@/features/privacy/retention-policy";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { AnonymizeSelectionButton, SelectAllCheckbox } from "@/components/backoffice/leads/selection";
import { SubjectExportButton } from "@/components/backoffice/leads/subject-export-button";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_TYPE_LABELS, PARTICIPATION_STATUS_LABELS } from "@/lib/labels";

export const metadata = { title: "Leads" };

// As ações da página (anonimizar pelos filtros, por lotes) podem demorar.
export const maxDuration = 300;

interface LeadsSearchParams {
  campaignId?: string;
  search?: string;
  period?: string;
  from?: string;
  to?: string;
  excludeTest?: string;
  marketingConsent?: string;
  hideAnonymized?: string;
  page?: string;
}

const SELECTION_FORM_ID = "lead-selection";
const MAX_OUTLOOK_CAMPAIGNS = 5;

const ANONYMIZE_WARNING =
  "Os dados pessoais (nome, e-mail, telefone, respostas ao formulário, IP) são apagados para sempre. Ficam o resultado, o prémio e as estatísticas. Não é possível desfazer.";

const PERIOD_LABELS: Record<string, string> = {
  today: "hoje",
  "7d": "últimos 7 dias",
  "30d": "últimos 30 dias",
  "90d": "últimos 90 dias",
  all: "todo o período",
  custom: "período personalizado",
};

/** O instante em que a página foi mostrada: a anonimização pelos filtros não passa dele. */
function renderedAt(): string {
  return new Date().toISOString();
}

const MARKETING_TONES: Record<string, "success" | "neutral" | "warning"> = {
  Concedido: "success",
  Recusado: "neutral",
  Parcial: "warning",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params: LeadsSearchParams = firstValues(await searchParams);
  const context = await requirePagePermission("leads:view");
  const { range, filters } = leadsFiltersFromParams(params);
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const excludeTest = filters.excludeTest !== false;
  const marketingConsent = filters.marketingConsent;
  const canManagePrivacy = can(context, "privacy:manage");

  const [campaigns, leads, toAnonymize, outlook] = await Promise.all([
    prisma.campaign.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, internalName: true, timezone: true },
      orderBy: { internalName: "asc" },
    }),
    listLeads(context.organizationId, range, { ...filters, page }),
    canManagePrivacy ? countLeadsToAnonymize(context.organizationId, range, filters) : Promise.resolve(0),
    // Aviso antes da anonimização (§24): o que o prazo vai levar em breve.
    retentionOutlook(context.organizationId, { campaignId: filters.campaignId }),
  ]);

  const rows = leads.items.map((item) => toLeadRow(item));
  const canExport = can(context, "leads:export");

  // Os filtros ativos, iguais na exportação, na paginação e na anonimização.
  const filterParams = leadsFiltersToParams(range, filters, params);
  const exportQuery = new URLSearchParams(filterParams).toString();
  const upcomingTotal = outlook.reduce((sum, campaign) => sum + campaign.upcoming, 0);
  const campaignTimezone = new Map(campaigns.map((campaign) => [campaign.id, campaign.timezone]));
  const asOf = renderedAt();
  // O que o diálogo da anonimização pelos filtros diz que vai apanhar.
  const selectedCampaign = campaigns.find((campaign) => campaign.id === filters.campaignId);
  const filterSummary = [
    selectedCampaign ? `campanha «${selectedCampaign.internalName}»` : "todas as campanhas",
    PERIOD_LABELS[range.preset] ?? range.preset,
    excludeTest ? "sem as de teste" : "incluindo as de teste",
    marketingConsent === "granted"
      ? "com consentimento de marketing aceite"
      : marketingConsent === "not_granted"
        ? "sem consentimento de marketing aceite"
        : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-caetano-anthracite">Leads</h1>
          <p className="mt-1 text-caetano-anthracite-80">Participações e leads angariados nas suas campanhas.</p>
        </div>
        {canExport && (
          <a href={`/api/leads/export?${exportQuery}`} className={buttonVariants({ variant: "outline" })}>
            Exportar CSV
          </a>
        )}
      </div>

      {upcomingTotal > 0 && (
        <div className="mb-6">
          <Alert variant="warning" live={false}>
            <p>
              {upcomingTotal === 1 ? "1 lead vai ser anonimizada" : `${upcomingTotal} leads vão ser anonimizadas`} nos
              próximos {RETENTION_WARNING_DAYS} dias, por fim do prazo de conservação.
              {canExport ? " Exporte antes as de que precisar." : ""}
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {outlook.slice(0, MAX_OUTLOOK_CAMPAIGNS).map((campaign) => (
                <li key={campaign.campaignId}>
                  {campaign.internalName}: {campaign.upcoming}
                  {campaign.nextAt &&
                    `, a primeira ${campaign.dueNow ? "na próxima execução" : `a ${campaign.nextAt.toLocaleDateString("pt-PT", { timeZone: campaignTimezone.get(campaign.campaignId) })}`}`}
                </li>
              ))}
            </ul>
            {outlook.length > MAX_OUTLOOK_CAMPAIGNS && (
              <p className="mt-1">E mais {outlook.length - MAX_OUTLOOK_CAMPAIGNS} campanhas.</p>
            )}
            {outlook.some((campaign) => campaign.overdue > 0) && (
              <p className="mt-1">
                Algumas já passaram o prazo há mais de dois dias e continuam com os dados
                {canManagePrivacy ? " (ver Configurações > Privacidade)" : ""}.
              </p>
            )}
          </Alert>
        </div>
      )}

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <div>
          <Label htmlFor="campaignId">Campanha</Label>
          <select
            id="campaignId"
            name="campaignId"
            defaultValue={params.campaignId ?? ""}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="">Todas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.internalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="search">Pesquisar</Label>
          <Input id="search" name="search" placeholder="Nome, e-mail ou telefone" defaultValue={params.search ?? ""} />
        </div>
        <div>
          <Label htmlFor="period">Período</Label>
          <select id="period" name="period" defaultValue={range.preset} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="today">Hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="all">Todo o período</option>
            <option value="custom">Personalizado</option>
          </select>
        </div>
        <div>
          <Label htmlFor="from">De</Label>
          <input id="from" type="date" name="from" defaultValue={params.from} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm" />
        </div>
        <div>
          <Label htmlFor="to">Até</Label>
          <input id="to" type="date" name="to" defaultValue={params.to} className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm" />
        </div>
        <div>
          <Label htmlFor="marketingConsent">Consentimento de marketing</Label>
          <select
            id="marketingConsent"
            name="marketingConsent"
            defaultValue={marketingConsent ?? ""}
            className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="">Todos</option>
            {/* "Com" inclui as leads «Parcial» (aceitaram pelo menos um). */}
            <option value="granted">Com consentimento aceite</option>
            <option value="not_granted">Sem consentimento aceite</option>
          </select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-caetano-anthracite">
          <input type="checkbox" name="excludeTest" value="true" defaultChecked={excludeTest} className="h-4 w-4 rounded border-caetano-medium-gray" />
          Excluir participações de teste
        </label>
        {/* Desmarcada, a caixa não vai no pedido e o filtro voltava a ligado:
            este "false" chega em segundo lugar e só conta quando ela não vai. */}
        <input type="hidden" name="excludeTest" value="false" />
        <label className="flex h-10 items-center gap-2 text-sm text-caetano-anthracite">
          <input
            type="checkbox"
            name="hideAnonymized"
            value="true"
            defaultChecked={filters.hideAnonymized}
            className="h-4 w-4 rounded border-caetano-medium-gray"
          />
          Ocultar anonimizadas
        </label>
        <Button type="submit" variant="outline">
          Aplicar filtros
        </Button>
      </form>

      {canManagePrivacy && (
        <section
          aria-labelledby="privacy-actions-heading"
          className="mb-3 space-y-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
        >
          <h2 id="privacy-actions-heading" className="text-sm font-bold text-caetano-anthracite">
            Dados pessoais
          </h2>
          <div className="flex flex-wrap items-start gap-3">
            {/* As caixas de cada linha pertencem a este formulário (form="…"). */}
            <ActionForm
              id={SELECTION_FORM_ID}
              action={anonymizeLeadsAction}
              resetOnSuccess={false}
              className="flex flex-col gap-1"
              messageClassName="max-w-md"
            >
              <input type="hidden" name="scope" value="selection" />
              <AnonymizeSelectionButton formId={SELECTION_FORM_ID} name="participationId" message={ANONYMIZE_WARNING} />
            </ActionForm>
            {/* Sempre montado: a resposta fica visível mesmo quando já não
                sobra nenhuma lead por anonimizar. */}
            <ActionForm action={anonymizeLeadsAction} resetOnSuccess={false} className="flex flex-col gap-1" messageClassName="max-w-md">
              <input type="hidden" name="scope" value="filters" />
              {Object.entries(filterParams).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <input type="hidden" name="asOf" value={asOf} />
              <input type="hidden" name="expected" value={toAnonymize} />
              <ConfirmSubmitButton
                disabled={toAnonymize === 0 || Boolean(filters.search)}
                confirmTitle={toAnonymize === 1 ? "Anonimizar 1 lead?" : `Anonimizar ${toAnonymize} leads?`}
                confirmMessage={`Todas as leads dos filtros aplicados, em todas as páginas: ${filterSummary}. ${ANONYMIZE_WARNING}`}
                confirmLabel="Anonimizar"
                variant="outline"
              >
                {toAnonymize === 1 ? "Anonimizar a lead dos filtros" : `Anonimizar as ${toAnonymize} leads dos filtros`}
              </ConfirmSubmitButton>
              {filters.search && (
                <p className="max-w-md text-xs text-caetano-anthracite-80">
                  A pesquisa procura partes do texto e apanharia outras pessoas: para um titular, use o pedido abaixo.
                </p>
              )}
            </ActionForm>
          </div>
          <ActionForm action={anonymizeLeadsAction} resetOnSuccess={false} className="flex flex-wrap items-end gap-2" messageClassName="basis-full">
            <input type="hidden" name="scope" value="subject" />
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <Label htmlFor="subject">Pedido de um titular: e-mail ou telefone</Label>
              <Input
                id="subject"
                name="subject"
                autoComplete="off"
                maxLength={254}
                aria-describedby="subject-help"
                required
              />
            </div>
            <SubmitButton variant="outline" name="intent" value="preview">
              Procurar
            </SubmitButton>
            <SubjectExportButton inputName="subject" />
            <ConfirmSubmitButton
              name="intent"
              value="anonymize"
              confirmTitle="Anonimizar os dados deste titular?"
              confirmMessage={`Todas as participações com este e-mail ou telefone exatos, em todas as campanhas e períodos (também nas respostas ao formulário). ${ANONYMIZE_WARNING}`}
              confirmLabel="Anonimizar"
              variant="outline"
            >
              Anonimizar os dados do titular
            </ConfirmSubmitButton>
            <p id="subject-help" className="basis-full text-xs text-caetano-anthracite-80">
              Só o e-mail ou o telefone exatos (não partes do texto), em todas as campanhas. «Procurar» diz
              quantas participações encontra; «Exportar» descarrega um ficheiro (JSON) com todos os dados do
              titular, para lhe enviar (pedido de acesso). Nenhum dos dois apaga nada.
            </p>
          </ActionForm>
        </section>
      )}

      <div
        tabIndex={0}
        role="region"
        aria-label="Tabela de leads"
        className="overflow-x-auto rounded-xl border border-caetano-medium-gray-40 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Participações e leads recolhidos</caption>
          <thead>
            <tr className="border-b border-caetano-medium-gray-20 text-left text-xs uppercase text-caetano-anthracite-80">
              {canManagePrivacy && (
                <th scope="col" className="px-4 py-3">
                  <SelectAllCheckbox formId={SELECTION_FORM_ID} name="participationId" label="Selecionar todas as leads desta página" />
                </th>
              )}
              <th scope="col" className="px-4 py-3">Data</th>
              <th scope="col" className="px-4 py-3">Campanha</th>
              <th scope="col" className="px-4 py-3">Nome</th>
              <th scope="col" className="px-4 py-3">Contacto</th>
              <th scope="col" className="px-4 py-3">Estado</th>
              <th scope="col" className="px-4 py-3">Resultado</th>
              <th scope="col" className="px-4 py-3">Prémio</th>
              <th scope="col" className="px-4 py-3">Marketing</th>
              <th scope="col" className="px-4 py-3">Origem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-caetano-medium-gray-20">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canManagePrivacy ? 10 : 9} className="px-4 py-8 text-center text-caetano-anthracite-80">
                  Nenhuma participação encontrada para os filtros atuais.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {canManagePrivacy && (
                    <td className="px-4 py-3">
                      {/* A chave muda com a anonimização: a caixa volta desmarcada. */}
                      <input
                        key={row.anonymizedAt || "com-dados"}
                        type="checkbox"
                        form={SELECTION_FORM_ID}
                        name="participationId"
                        value={row.id}
                        disabled={Boolean(row.anonymizedAt)}
                        aria-label={`Selecionar a lead de ${row.createdAt.toLocaleString("pt-PT")}`}
                        className="h-4 w-4 rounded border-caetano-medium-gray"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap text-caetano-anthracite-80">
                    {row.createdAt.toLocaleString("pt-PT")}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/apps/${row.campaignId}/informacoes`} className="hover:underline">
                      {row.campaignName}
                    </Link>
                    <span className="ml-1 text-xs text-caetano-anthracite-80">
                      ({CAMPAIGN_TYPE_LABELS[row.campaignType as keyof typeof CAMPAIGN_TYPE_LABELS]})
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.anonymizedAt ? (
                      <span className="whitespace-nowrap">
                        <Badge tone="neutral">Anonimizada</Badge>
                        <span className="block text-xs text-caetano-anthracite-80">
                          {new Date(row.anonymizedAt).toLocaleDateString("pt-PT", {
                            timeZone: campaignTimezone.get(row.campaignId),
                          })}
                        </span>
                      </span>
                    ) : (
                      row.name || "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.email || row.phone || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={row.status === "COMPLETED" ? "success" : "neutral"}>
                      {PARTICIPATION_STATUS_LABELS[row.status as keyof typeof PARTICIPATION_STATUS_LABELS] ?? row.status}
                    </Badge>
                    {row.isTest && (
                      <Badge tone="warning">Teste</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.result} {row.score && `· ${row.score}`}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">
                    {row.prize}
                    {row.code && <span className="ml-1 font-mono text-xs">({row.code})</span>}
                    {row.prizeStatus && row.prizeStatus !== "Atribuído" && (
                      <span className="block text-xs">{row.prizeStatus}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.marketingConsent ? (
                      <Badge tone={MARKETING_TONES[row.marketingConsent] ?? "neutral"}>{row.marketingConsent}</Badge>
                    ) : (
                      <span className="text-caetano-anthracite-80">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-caetano-anthracite-80">{row.source || row.utmSource || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={leads.page}
        pageCount={leads.pageCount}
        total={leads.total}
        label="Paginação de leads"
        buildHref={(target) => `/leads?${new URLSearchParams({ ...filterParams, page: String(target) }).toString()}`}
      />
    </div>
  );
}
