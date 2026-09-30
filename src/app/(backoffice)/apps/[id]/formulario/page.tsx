import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { prisma } from "@/server/db/client";
import {
  addConsentAction,
  addLeadFieldAction,
  moveLeadFieldAction,
  removeConsentAction,
  removeLeadFieldAction,
  updateConsentAction,
  updateLeadFieldAction,
  updateLeadFormSettingsAction,
} from "@/features/campaigns/steps/lead-form-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import {
  DEDUP_STRATEGY_LABELS,
  LEAD_FIELD_TYPE_LABELS,
  LEAD_FORM_POSITION_LABELS,
} from "@/lib/labels";
import { CONSENT_LIMITS, fieldTypeHasOptions, LEAD_FIELD_LIMITS } from "@/lib/validation/lead-form";
import { Alert } from "@/components/ui/alert";
import { isLiveStatus } from "@/features/campaigns/live-status";
import { hasPrivacyNotice, LIVE_PRIVACY_NOTICE_MISSING_WARNING } from "@/features/publishing/readiness";
import { can } from "@/server/permissions";
import { updateCampaignRetentionAction } from "@/features/privacy/actions";
import { retentionOutlook } from "@/features/privacy/retention-queries";
import {
  describeRetention,
  effectiveRetention,
  RETENTION_DAY_OPTIONS,
  RETENTION_WARNING_DAYS,
} from "@/features/privacy/retention-policy";
import { utcToZonedDateTimeLocal } from "@/lib/dates/timezone";
import type { DedupStrategy, LeadFieldType } from "@/generated/prisma/client";

const MOVE_BUTTON_CLASS =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-30";
const SUMMARY_CLASS =
  "cursor-pointer list-none select-none rounded text-sm text-caetano-deep-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan";
const TEXTAREA_CLASS = "w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm aria-invalid:border-danger";

export default async function LeadFormStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      theme: { select: { legalLinks: true } },
      organization: { select: { dataRetentionDays: true, dataRetentionChangedAt: true } },
      leadForm: {
        include: {
          fields: { orderBy: { order: "asc" } },
          consentDefinitions: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!campaign || !campaign.leadForm) notFound();

  const { leadForm } = campaign;
  const privacyNoticeMissing = isLiveStatus(campaign.status) && !hasPrivacyNotice(campaign);

  const canManagePrivacy = can(context, "privacy:manage");
  const retention = effectiveRetention({
    campaign,
    organizationDays: campaign.organization.dataRetentionDays,
    organizationChangedAt: campaign.organization.dataRetentionChangedAt,
  });
  const [retentionSoon, anonymizedCount] = await Promise.all([
    retentionOutlook(context.organizationId, { campaignId: campaign.id }).then((outlook) => outlook[0] ?? null),
    prisma.participation.count({ where: { campaignId: campaign.id, anonymizedAt: { not: null } } }),
  ]);
  const retentionValue = campaign.dataRetentionUntil
    ? "until"
    : campaign.dataRetentionDays
      ? String(campaign.dataRetentionDays)
      : "inherit";
  const organizationDays = campaign.organization.dataRetentionDays;
  // Consentimentos já aceites (não se removem). Só os deste formulário: o
  // `_count` do Prisma agregava a tabela ConsentRecord inteira.
  const consentsInUse = new Set(
    (
      await prisma.consentRecord.groupBy({
        by: ["consentDefinitionId"],
        // As respostas de teste não contam (removê-lo apaga-as também).
        where: {
          consentDefinitionId: { in: leadForm.consentDefinitions.map((consent) => consent.id) },
          participation: { isTest: false },
        },
      })
    ).map((row) => row.consentDefinitionId),
  );

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-bold text-caetano-anthracite">Formulário de leads</h2>
        <p className="mt-1 text-sm text-caetano-anthracite-80">
          Configure onde e que dados recolher dos participantes.
        </p>
      </div>

      {privacyNoticeMissing ? <Alert variant="warning" live={false}>{LIVE_PRIVACY_NOTICE_MISSING_WARNING}</Alert> : null}

      <AutoSaveForm action={updateLeadFormSettingsAction} className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <div>
          <Label htmlFor="position">Posição do formulário</Label>
          <select
            id="position"
            name="position"
            defaultValue={leadForm.position}
            aria-describedby="position-help"
            className="h-10 w-full max-w-sm rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            {Object.entries(LEAD_FORM_POSITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {/* Ajuda contextual (§7): o que cada posição retém até à lead. */}
          <ul id="position-help" className="mt-2 list-disc space-y-1 pl-5 text-xs text-caetano-anthracite-80">
            <li>
              Na Roda da Sorte, com o formulário depois do jogo, o prémio sorteado fica reservado até a lead ser
              aceite: o código só é mostrado depois do formulário. Uma lead recusada (duplicada, bot) ou um
              formulário abandonado devolve o prémio ao stock.
            </li>
            <li>
              Mudar a posição só afeta quem começar a jogar a partir de agora. Escolher «Sem formulário» (ou não
              ter campos nem consentimentos) deixa de pedir o formulário também a quem já está a jogar.
            </li>
          </ul>
        </div>

        <CheckboxField name="honeypotEnabled" defaultChecked={leadForm.honeypotEnabled}>
          Ativar honeypot anti-bot
        </CheckboxField>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-caetano-anthracite">
            Controlo de duplicados
          </legend>
          {/* Sentinela do grupo: sem nenhuma marcada, o envio diz "nenhuma". */}
          <input type="hidden" name="dedupStrategies" value="" />
          <div className="flex flex-wrap gap-3">
            {(Object.entries(DEDUP_STRATEGY_LABELS) as [DedupStrategy, string][]).map(
              ([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm text-caetano-anthracite">
                  <input
                    type="checkbox"
                    name="dedupStrategies"
                    value={value}
                    defaultChecked={campaign.dedupStrategies.includes(value)}
                    className="h-4 w-4 rounded border-caetano-medium-gray"
                  />
                  {label}
                </label>
              ),
            )}
          </div>
        </fieldset>
      </AutoSaveForm>

      {leadForm.position !== "NONE" && (
        <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
          <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">Campos</h3>

          <ul className="space-y-2">
            {leadForm.fields.map((field, index) => (
              <li key={field.id} className="rounded-lg border border-caetano-medium-gray-20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <span className="font-medium text-caetano-anthracite">{field.label}</span>
                    <span className="ml-2 text-xs text-caetano-anthracite-80">
                      {LEAD_FIELD_TYPE_LABELS[field.type]}
                      {field.required && field.type !== "HIDDEN" ? " · obrigatório" : ""}
                    </span>
                    {field.type === "HIDDEN" && !field.defaultValue && (
                      <span className="mt-1 block text-xs text-danger">
                        Sem valor predefinido: este campo não grava nada. Indique-o em «Editar campo».
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Sem reset: remontar o botão tirava-lhe o foco a meio de uma reordenação. */}
                    <ActionForm action={moveLeadFieldAction} resetOnSuccess={false}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={index === 0}
                        className={MOVE_BUTTON_CLASS}
                        aria-label={`Mover ${field.label} para cima`}
                      >
                        ↑
                      </button>
                    </ActionForm>
                    <ActionForm action={moveLeadFieldAction} resetOnSuccess={false}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={index === leadForm.fields.length - 1}
                        className={MOVE_BUTTON_CLASS}
                        aria-label={`Mover ${field.label} para baixo`}
                      >
                        ↓
                      </button>
                    </ActionForm>
                    <ActionForm action={removeLeadFieldAction} resetOnSuccess={false}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <ConfirmSubmitButton confirmMessage={`Remover o campo "${field.label}"?`} size="sm">
                        Remover
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </div>

                {/* Abre por baixo da linha, com a largura do cartão: o antigo
                    popover de 20rem saía do ecrã no telemóvel. */}
                <details className="mt-2">
                  <summary className={SUMMARY_CLASS}>
                    Editar campo<span className="sr-only"> {field.label}</span>
                  </summary>
                  {/* Sem expressão de validação: não vai no envio e fica como
                      está. O valor predefinido só nos campos ocultos, onde é
                      o único valor que o campo grava. */}
                  <AutoSaveForm action={updateLeadFieldAction} className="mt-2 space-y-2">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="fieldId" value={field.id} />
                    <div>
                      <Label htmlFor={`label-${field.id}`}>Label</Label>
                      <Input
                        id={`label-${field.id}`}
                        name="label"
                        maxLength={LEAD_FIELD_LIMITS.label}
                        defaultValue={field.label}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor={`placeholder-${field.id}`}>Placeholder</Label>
                      <Input
                        id={`placeholder-${field.id}`}
                        name="placeholder"
                        maxLength={LEAD_FIELD_LIMITS.placeholder}
                        defaultValue={field.placeholder ?? ""}
                      />
                    </div>
                    <div>
                      <Label htmlFor={`helpText-${field.id}`}>Texto de ajuda</Label>
                      <Input
                        id={`helpText-${field.id}`}
                        name="helpText"
                        maxLength={LEAD_FIELD_LIMITS.helpText}
                        defaultValue={field.helpText ?? ""}
                      />
                    </div>
                    {fieldTypeHasOptions(field.type) && (
                      <div>
                        <Label htmlFor={`options-${field.id}`}>Opções (uma por linha)</Label>
                        <textarea
                          id={`options-${field.id}`}
                          name="options"
                          rows={3}
                          maxLength={LEAD_FIELD_LIMITS.options}
                          defaultValue={
                            Array.isArray(field.options)
                              ? field.options.filter((option) => typeof option === "string").join("\n")
                              : ""
                          }
                          className={TEXTAREA_CLASS}
                        />
                      </div>
                    )}
                    <div>
                      <Label htmlFor={`exportMapping-${field.id}`}>Mapeamento de exportação</Label>
                      <Input
                        id={`exportMapping-${field.id}`}
                        name="exportMapping"
                        maxLength={LEAD_FIELD_LIMITS.exportMapping}
                        defaultValue={field.exportMapping ?? ""}
                      />
                    </div>
                    {field.type === "HIDDEN" ? (
                      <div>
                        <Label htmlFor={`defaultValue-${field.id}`}>Valor predefinido</Label>
                        <Input
                          id={`defaultValue-${field.id}`}
                          name="defaultValue"
                          maxLength={LEAD_FIELD_LIMITS.defaultValue}
                          defaultValue={field.defaultValue ?? ""}
                          aria-describedby={`defaultValue-help-${field.id}`}
                        />
                        <p id={`defaultValue-help-${field.id}`} className="mt-1 text-xs text-caetano-anthracite-80">
                          O participante não vê este campo: cada lead grava este valor (por exemplo, a origem da
                          campanha).
                        </p>
                      </div>
                    ) : (
                      <CheckboxField name="required" defaultChecked={field.required}>
                        Obrigatório
                      </CheckboxField>
                    )}
                  </AutoSaveForm>
                </details>
              </li>
            ))}
          </ul>

          <ActionForm
            action={addLeadFieldAction}
            className="mt-4 flex flex-wrap items-end gap-2"
            messageClassName="basis-full"
          >
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div>
              <Label htmlFor="newFieldType">Tipo de campo</Label>
              <select
                id="newFieldType"
                name="type"
                className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm"
              >
                {(Object.entries(LEAD_FIELD_TYPE_LABELS) as [LeadFieldType, string][]).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="min-w-0 flex-1 sm:flex-none">
              <Label htmlFor="newFieldLabel">Label</Label>
              <Input id="newFieldLabel" name="label" maxLength={LEAD_FIELD_LIMITS.label} required />
            </div>
            <SubmitButton variant="outline">Adicionar campo</SubmitButton>
          </ActionForm>
        </div>
      )}

      <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-1 text-sm font-bold text-caetano-anthracite">Consentimentos</h3>
        <p className="mb-3 text-xs text-caetano-anthracite-80">
          Consentimentos de marketing nunca aparecem pré-selecionados aos participantes e não podem ser
          obrigatórios.
        </p>

        <ul className="space-y-2">
          {leadForm.consentDefinitions.map((consent) => (
            <li key={consent.id} className="rounded-lg border border-caetano-medium-gray-20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p id={`consent-${consent.id}`} className="whitespace-pre-line break-words text-sm text-caetano-anthracite">
                    {consent.text}
                  </p>
                  <p className="text-xs text-caetano-anthracite-80">
                    Versão {consent.version}
                    {consent.isMarketing ? " · marketing" : ""}
                    {consent.required ? " · obrigatório" : ""}
                  </p>
                </div>
                {/* O registo de cada aceitação aponta para esta definição. */}
                {consentsInUse.has(consent.id) ? (
                  <span className="max-w-40 text-right text-xs text-caetano-anthracite-80">
                    Já aceite por participantes, não pode ser removido.
                  </span>
                ) : (
                  <ActionForm action={removeConsentAction} resetOnSuccess={false} messageClassName="max-w-40">
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="consentId" value={consent.id} />
                    <ConfirmSubmitButton confirmMessage="Remover este consentimento?" size="sm">
                      Remover
                    </ConfirmSubmitButton>
                  </ActionForm>
                )}
              </div>

              <details className="mt-2">
                {/* Há vários "Editar consentimento": o texto diz qual. */}
                <summary className={SUMMARY_CLASS} aria-describedby={`consent-${consent.id}`}>
                  Editar consentimento
                </summary>
                <ActionForm action={updateConsentAction} resetOnSuccess={false} className="mt-2 space-y-2">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <input type="hidden" name="consentId" value={consent.id} />
                  <div>
                    <Label htmlFor={`consent-text-${consent.id}`}>Texto do consentimento</Label>
                    <textarea
                      id={`consent-text-${consent.id}`}
                      name="text"
                      defaultValue={consent.text}
                      rows={3}
                      maxLength={CONSENT_LIMITS.text}
                      required
                      aria-describedby={`consent-version-${consent.id}`}
                      className={TEXTAREA_CLASS}
                    />
                    <p id={`consent-version-${consent.id}`} className="mt-1 text-xs text-caetano-anthracite-80">
                      Mudar o texto cria uma nova versão; as aceitações anteriores ficam com o texto que foi mostrado.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    <CheckboxField name="isMarketing" defaultChecked={consent.isMarketing}>
                      Marketing
                    </CheckboxField>
                    <CheckboxField name="required" defaultChecked={consent.required}>
                      Obrigatório
                    </CheckboxField>
                  </div>
                  <SubmitButton size="sm" variant="outline">
                    Guardar
                  </SubmitButton>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>

        <ActionForm action={addConsentAction} className="mt-4 space-y-2">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div>
            <Label htmlFor="newConsentText">Novo consentimento</Label>
            <textarea
              id="newConsentText"
              name="text"
              placeholder="Texto do consentimento…"
              rows={2}
              maxLength={CONSENT_LIMITS.text}
              required
              className={TEXTAREA_CLASS}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <CheckboxField name="isMarketing">Marketing</CheckboxField>
            <CheckboxField name="required">Obrigatório</CheckboxField>
            <SubmitButton variant="outline" size="sm">
              Adicionar consentimento
            </SubmitButton>
          </div>
        </ActionForm>
      </div>

      <section
        aria-labelledby="retention-heading"
        className="space-y-3 rounded-xl border border-caetano-medium-gray-40 bg-white p-4"
      >
        <div>
          <h3 id="retention-heading" className="text-sm font-bold text-caetano-anthracite">
            Conservação dos dados
          </h3>
          <p className="mt-1 text-xs text-caetano-anthracite-80">
            Ao fim do prazo, os dados pessoais de cada participação (nome, e-mail, telefone, respostas ao
            formulário, IP) são anonimizados por uma tarefa diária. Ficam o resultado, o prémio e as estatísticas.
            As participações anonimizadas deixam de contar para os limites de participação.
          </p>
        </div>

        {canManagePrivacy ? (
          <AutoSaveForm action={updateCampaignRetentionAction} className="space-y-3">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div>
              <Label htmlFor="retention">Prazo de conservação</Label>
              <select
                id="retention"
                name="retention"
                defaultValue={retentionValue}
                className="h-10 w-full max-w-sm rounded-lg border border-caetano-medium-gray px-3 text-sm"
              >
                <option value="inherit">
                  {organizationDays
                    ? `O da organização (${organizationDays} dias)`
                    : "O da organização (sem prazo)"}
                </option>
                {RETENTION_DAY_OPTIONS.map((days) => (
                  <option key={days} value={days}>
                    {days} dias depois de cada participação
                  </option>
                ))}
                <option value="until">Numa data (todas as participações)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="retentionUntil">Data de anonimização (só para «Numa data»)</Label>
              <input
                id="retentionUntil"
                name="retentionUntil"
                type="date"
                defaultValue={
                  campaign.dataRetentionUntil
                    ? utcToZonedDateTimeLocal(campaign.dataRetentionUntil, campaign.timezone).slice(0, 10)
                    : ""
                }
                aria-describedby="retentionUntil-help"
                className="h-10 rounded-lg border border-caetano-medium-gray px-3 text-sm aria-invalid:border-danger"
              />
              <p id="retentionUntil-help" className="mt-1 text-xs text-caetano-anthracite-80">
                Pelo menos {RETENTION_WARNING_DAYS} dias depois de hoje. A partir das 00:00 desse dia (
                {campaign.timezone}), todas as participações da campanha são anonimizadas, e as que chegarem depois
                também, um dia depois de criadas.
              </p>
            </div>
            <p className="text-xs text-caetano-anthracite-80">
              Em vigor: {describeRetention(retention, campaign.timezone)} Um prazo novo ou alterado só começa a
              anonimizar {RETENTION_WARNING_DAYS} dias depois da alteração.
            </p>
          </AutoSaveForm>
        ) : (
          <p className="text-sm text-caetano-anthracite">
            {describeRetention(retention, campaign.timezone)}{" "}
            <span className="text-xs text-caetano-anthracite-80">Só um administrador pode mudar o prazo.</span>
          </p>
        )}

        {retentionSoon && (
          <Alert variant="warning" live={false}>
            {retentionSoon.upcoming === 1
              ? "1 participação vai ser anonimizada"
              : `${retentionSoon.upcoming} participações vão ser anonimizadas`}{" "}
            nos próximos {RETENTION_WARNING_DAYS} dias
            {retentionSoon.dueNow
              ? " (a primeira já passou o prazo e sai na próxima execução da tarefa diária)"
              : retentionSoon.nextAt
                ? ` (a primeira a ${retentionSoon.nextAt.toLocaleDateString("pt-PT", { timeZone: campaign.timezone })})`
                : ""}
            . Exporte antes as leads de que precisar.
          </Alert>
        )}
        {anonymizedCount > 0 && (
          <p className="text-xs text-caetano-anthracite-80">
            {anonymizedCount === 1 ? "1 participação já foi anonimizada." : `${anonymizedCount} participações já foram anonimizadas.`}
          </p>
        )}
      </section>
    </div>
  );
}
