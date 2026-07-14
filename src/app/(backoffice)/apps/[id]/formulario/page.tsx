import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
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
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import {
  DEDUP_STRATEGY_LABELS,
  LEAD_FIELD_TYPE_LABELS,
  LEAD_FORM_POSITION_LABELS,
} from "@/lib/labels";
import { fieldTypeHasOptions } from "@/lib/validation/lead-form";
import type { DedupStrategy, LeadFieldType } from "@/generated/prisma/client";

export default async function LeadFormStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
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

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Formulário de leads</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Configure onde e que dados recolher dos participantes.
        </p>
      </div>

      <AutoSaveForm action={updateLeadFormSettingsAction} className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <div>
          <Label htmlFor="position">Posição do formulário</Label>
          <select
            id="position"
            name="position"
            defaultValue={leadForm.position}
            className="h-10 w-full max-w-sm rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            {Object.entries(LEAD_FORM_POSITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
          <input
            type="checkbox"
            name="honeypotEnabled"
            defaultChecked={leadForm.honeypotEnabled}
            className="h-4 w-4 rounded border-caetano-medium-gray"
          />
          Ativar honeypot anti-bot
        </label>

        <fieldset>
          <legend className="mb-1 text-sm font-medium text-caetano-anthracite">
            Controlo de duplicados
          </legend>
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

        <SaveStatus />
      </AutoSaveForm>

      {leadForm.position !== "NONE" && (
        <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">Campos</h3>

          <ul className="space-y-2">
            {leadForm.fields.map((field, index) => (
              <li key={field.id} className="rounded-lg border border-caetano-medium-gray/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-caetano-anthracite">{field.label}</span>
                    <span className="ml-2 text-xs text-caetano-medium-gray">
                      {LEAD_FIELD_TYPE_LABELS[field.type]}
                      {field.required ? " · obrigatório" : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={moveLeadFieldAction}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={index === 0}
                        className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30"
                        aria-label="Mover para cima"
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveLeadFieldAction}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={index === leadForm.fields.length - 1}
                        className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30"
                        aria-label="Mover para baixo"
                      >
                        ↓
                      </button>
                    </form>
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded px-2 py-1 text-sm text-caetano-cyan">
                        Editar
                      </summary>
                      <AutoSaveForm
                        action={updateLeadFieldAction}
                        className="absolute right-0 z-10 mt-1 w-80 space-y-2 rounded-lg border border-caetano-medium-gray/30 bg-white p-3 shadow-lg"
                      >
                        <input type="hidden" name="campaignId" value={campaign.id} />
                        <input type="hidden" name="fieldId" value={field.id} />
                        <div>
                          <Label htmlFor={`label-${field.id}`}>Label</Label>
                          <Input id={`label-${field.id}`} name="label" defaultValue={field.label} required />
                        </div>
                        <div>
                          <Label htmlFor={`placeholder-${field.id}`}>Placeholder</Label>
                          <Input
                            id={`placeholder-${field.id}`}
                            name="placeholder"
                            defaultValue={field.placeholder ?? ""}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`helpText-${field.id}`}>Texto de ajuda</Label>
                          <Input id={`helpText-${field.id}`} name="helpText" defaultValue={field.helpText ?? ""} />
                        </div>
                        {fieldTypeHasOptions(field.type) && (
                          <div>
                            <Label htmlFor={`options-${field.id}`}>Opções (uma por linha)</Label>
                            <textarea
                              id={`options-${field.id}`}
                              name="options"
                              rows={3}
                              defaultValue={
                                Array.isArray(field.options) ? (field.options as string[]).join("\n") : ""
                              }
                              className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
                            />
                          </div>
                        )}
                        <div>
                          <Label htmlFor={`exportMapping-${field.id}`}>Mapeamento de exportação</Label>
                          <Input
                            id={`exportMapping-${field.id}`}
                            name="exportMapping"
                            defaultValue={field.exportMapping ?? ""}
                          />
                        </div>
                        <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
                          <input
                            type="checkbox"
                            name="required"
                            defaultChecked={field.required}
                            className="h-4 w-4 rounded border-caetano-medium-gray"
                          />
                          Obrigatório
                        </label>
                        <SaveStatus />
                      </AutoSaveForm>
                    </details>
                    <form action={removeLeadFieldAction}>
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <ConfirmSubmitButton confirmMessage={`Remover o campo "${field.label}"?`} size="sm">
                        Remover
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <form action={addLeadFieldAction} className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <div>
              <Label htmlFor="type">Tipo de campo</Label>
              <select
                id="type"
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
            <div>
              <Label htmlFor="label">Label</Label>
              <Input id="label" name="label" required />
            </div>
            <Button type="submit" variant="outline">
              Adicionar campo
            </Button>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-caetano-anthracite">Consentimentos</h3>
        <p className="mb-3 text-xs text-caetano-medium-gray">
          Consentimentos de marketing nunca aparecem pré-selecionados aos participantes.
        </p>

        <ul className="space-y-2">
          {leadForm.consentDefinitions.map((consent) => (
            <li key={consent.id} className="rounded-lg border border-caetano-medium-gray/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-sm text-caetano-anthracite">{consent.text}</p>
                  <p className="text-xs text-caetano-medium-gray">
                    Versão {consent.version}
                    {consent.isMarketing ? " · marketing" : ""}
                    {consent.required ? " · obrigatório" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <details>
                    <summary className="cursor-pointer text-sm text-caetano-cyan">Editar</summary>
                    <form action={updateConsentAction} className="mt-2 w-72 space-y-2">
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <input type="hidden" name="consentId" value={consent.id} />
                      <textarea
                        name="text"
                        defaultValue={consent.text}
                        rows={3}
                        required
                        className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="isMarketing"
                          defaultChecked={consent.isMarketing}
                          className="h-4 w-4 rounded border-caetano-medium-gray"
                        />
                        Marketing
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="required"
                          defaultChecked={consent.required}
                          className="h-4 w-4 rounded border-caetano-medium-gray"
                        />
                        Obrigatório
                      </label>
                      <Button type="submit" size="sm" variant="outline">
                        Guardar (nova versão se o texto mudar)
                      </Button>
                    </form>
                  </details>
                  <form action={removeConsentAction}>
                    <input type="hidden" name="campaignId" value={campaign.id} />
                    <input type="hidden" name="consentId" value={consent.id} />
                    <ConfirmSubmitButton confirmMessage="Remover este consentimento?" size="sm">
                      Remover
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <form action={addConsentAction} className="mt-4 space-y-2">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <textarea
            name="text"
            placeholder="Texto do consentimento…"
            rows={2}
            required
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isMarketing" className="h-4 w-4 rounded border-caetano-medium-gray" />
              Marketing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="required" className="h-4 w-4 rounded border-caetano-medium-gray" />
              Obrigatório
            </label>
            <Button type="submit" variant="outline" size="sm">
              Adicionar consentimento
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
