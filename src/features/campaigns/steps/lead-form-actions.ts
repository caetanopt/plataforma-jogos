"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { databaseErrorKind, runAction } from "@/server/actions/run-action";
import {
  addLeadFieldSchema,
  CONSENT_IN_USE_MESSAGE,
  consentSchema,
  fieldTypeHasOptions,
  leadFieldShape,
  leadFormSettingsShape,
  normalizeNewlines,
} from "@/lib/validation/lead-form";
import { emptyToNull, getField, readCheckbox, readMultiple, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import {
  editBreaksLiveAgeCheck,
  LIVE_BIRTH_DATE_REQUIRED_MESSAGE,
  LIVE_POSITION_NEEDS_FORM_MESSAGE,
  type AgeCheckForm,
} from "@/features/publishing/age-check";
import { fail, ok, partialResult, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";
import { slugify } from "@/lib/random/slug";

async function getOwnedLeadForm(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: {
      leadForm: {
        include: { fields: { select: { id: true, type: true } }, _count: { select: { consentDefinitions: true } } },
      },
    },
  });
  return campaign?.leadForm ? { campaign, leadForm: campaign.leadForm } : null;
}

type OwnedLeadForm = NonNullable<Awaited<ReturnType<typeof getOwnedLeadForm>>>;

function ageFormOf(leadForm: OwnedLeadForm["leadForm"]): AgeCheckForm {
  return { position: leadForm.position, fields: leadForm.fields, consentCount: leadForm._count.consentDefinitions };
}

/** A edição fecharia a campanha publicada por a idade deixar de se verificar. */
function breaksLiveAgeCheck(owned: OwnedLeadForm, after: AgeCheckForm): boolean {
  const { campaign } = owned;
  return editBreaksLiveAgeCheck(
    campaign.status,
    { minAge: campaign.minAge, form: ageFormOf(owned.leadForm) },
    { minAge: campaign.minAge, form: after },
  );
}

function formPath(campaignId: string): string {
  return `/apps/${campaignId}/formulario`;
}

const FIELD_GONE_MESSAGE = "O campo já não existe. Recarregue a página.";
const CONSENT_GONE_MESSAGE = "O consentimento já não existe. Recarregue a página.";

export async function updateLeadFormSettingsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateLeadFormSettings", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    // O grupo de duplicados leva uma sentinela vazia: sem nenhuma marcada
    // chega [] (desligar tudo), e não "campo ausente".
    const parse = parsePartial(leadFormSettingsShape, {
      position: readOptional(formData, "position"),
      honeypotEnabled: readCheckbox(formData, "honeypotEnabled"),
      dedupStrategies: readMultiple(formData, "dedupStrategies"),
    });
    const { data, fieldErrors } = parse;

    if (data.position !== undefined && breaksLiveAgeCheck(owned, { ...ageFormOf(owned.leadForm), position: data.position })) {
      rejectField(parse, "position", LIVE_POSITION_NEEDS_FORM_MESSAGE);
    }

    const leadFormUpdate = { position: data.position, honeypotEnabled: data.honeypotEnabled };
    const changedLeadForm = Object.values(leadFormUpdate).some((value) => value !== undefined);
    const changedCampaign = data.dedupStrategies !== undefined;
    const savedSomething = changedLeadForm || changedCampaign;

    if (savedSomething) {
      await prisma.$transaction([
        ...(changedLeadForm
          ? [prisma.leadForm.update({ where: { id: owned.leadForm.id }, data: leadFormUpdate })]
          : []),
        ...(changedCampaign
          ? [prisma.campaign.update({ where: { id: owned.campaign.id }, data: { dedupStrategies: data.dedupStrategies } })]
          : []),
      ]);

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "LeadForm",
        entityId: owned.leadForm.id,
        result: "SUCCESS",
        metadata: { fields: Object.keys(data) },
      });

      revalidatePath(formPath(owned.campaign.id));
    }

    return partialResult(fieldErrors, savedSomething);
  });
}

export async function addLeadFieldAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addLeadField", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    const parsed = addLeadFieldSchema.safeParse({
      type: getField(formData, "type"),
      label: getField(formData, "label"),
    });
    if (!parsed.success) return fail("O campo não foi adicionado.", zodFieldErrors(parsed.error));

    const existingFields = await prisma.leadFormField.findMany({
      where: { leadFormId: owned.leadForm.id },
      select: { internalKey: true, order: true },
    });

    const baseKey = slugify(parsed.data.label) || slugify(parsed.data.type);
    let internalKey = baseKey;
    let suffix = 1;
    const existingKeys = new Set(existingFields.map((f) => f.internalKey));
    while (existingKeys.has(internalKey)) {
      internalKey = `${baseKey}-${suffix}`;
      suffix += 1;
    }

    const nextOrder = existingFields.reduce((max, f) => Math.max(max, f.order), -1) + 1;

    const created = await prisma.leadFormField.create({
      data: {
        leadFormId: owned.leadForm.id,
        type: parsed.data.type,
        label: parsed.data.label,
        internalKey,
        order: nextOrder,
        required: false,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "LeadFormField",
      entityId: created.id,
      result: "SUCCESS",
      metadata: { type: parsed.data.type, leadFormId: owned.leadForm.id },
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok("Campo adicionado.");
  });
}

export async function updateLeadFieldAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateLeadField", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const fieldId = readOptional(formData, "fieldId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    const field = await prisma.leadFormField.findFirst({
      where: { id: fieldId, leadFormId: owned.leadForm.id },
    });
    if (!field) notFound();

    // Antes lia tudo com `formData.get`, que dá null para o que o formulário
    // não tem (expressão de validação, valor predefinido, opções fora dos
    // tipos de escolha), e o zod recusava null: o campo nunca gravava. Agora
    // o que não vem fica como está. As opções só contam nos tipos de escolha.
    const { data, fieldErrors } = parsePartial(leadFieldShape, {
      label: readOptional(formData, "label"),
      placeholder: readOptional(formData, "placeholder"),
      helpText: readOptional(formData, "helpText"),
      required: readCheckbox(formData, "required"),
      validationRegex: readOptional(formData, "validationRegex"),
      defaultValue: readOptional(formData, "defaultValue"),
      options: fieldTypeHasOptions(field.type) ? readOptional(formData, "options") : undefined,
      exportMapping: readOptional(formData, "exportMapping"),
    });

    const update = {
      label: data.label,
      placeholder: emptyToNull(data.placeholder),
      helpText: emptyToNull(data.helpText),
      required: data.required,
      validationRegex: emptyToNull(data.validationRegex),
      defaultValue: emptyToNull(data.defaultValue),
      options: data.options,
      exportMapping: emptyToNull(data.exportMapping),
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.leadFormField.update({ where: { id: field.id }, data: update });

      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "LeadFormField",
        entityId: field.id,
        result: "SUCCESS",
        metadata: { fields: Object.keys(data) },
      });

      revalidatePath(formPath(owned.campaign.id));
    }

    return partialResult(fieldErrors, savedSomething);
  });
}

export async function removeLeadFieldAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeLeadField", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const fieldId = readOptional(formData, "fieldId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    if (!owned.leadForm.fields.some((field) => field.id === fieldId)) return fail(FIELD_GONE_MESSAGE);
    const remaining = owned.leadForm.fields.filter((field) => field.id !== fieldId);
    if (breaksLiveAgeCheck(owned, { ...ageFormOf(owned.leadForm), fields: remaining })) {
      return fail(LIVE_BIRTH_DATE_REQUIRED_MESSAGE);
    }

    const deleted = await prisma.leadFormField.deleteMany({ where: { id: fieldId, leadFormId: owned.leadForm.id } });
    if (deleted.count === 0) return fail(FIELD_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "LeadFormField",
      entityId: fieldId,
      result: "SUCCESS",
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok();
  });
}

export async function moveLeadFieldAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("moveLeadField", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const fieldId = readOptional(formData, "fieldId") ?? "";
    const direction = readOptional(formData, "direction");
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();
    if (direction !== "up" && direction !== "down") return fail("Direção inválida. Recarregue a página.");

    const fields = await prisma.leadFormField.findMany({
      where: { leadFormId: owned.leadForm.id },
      orderBy: { order: "asc" },
    });
    const index = fields.findIndex((f) => f.id === fieldId);
    if (index === -1) return fail(FIELD_GONE_MESSAGE);

    // Os botões das pontas vêm desativados; isto é uma página desatualizada.
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0) return fail("O campo já é o primeiro da lista.");
    if (swapIndex >= fields.length) return fail("O campo já é o último da lista.");

    const current = fields[index];
    const swapWith = fields[swapIndex];

    await prisma.$transaction([
      prisma.leadFormField.update({ where: { id: current.id }, data: { order: swapWith.order } }),
      prisma.leadFormField.update({ where: { id: swapWith.id }, data: { order: current.order } }),
    ]);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "LeadFormField",
      entityId: current.id,
      result: "SUCCESS",
      metadata: { action: "reorder", swappedWith: swapWith.id },
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok();
  });
}

export async function addConsentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addConsent", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    const parsed = consentSchema.safeParse({
      text: getField(formData, "text"),
      isMarketing: readCheckbox(formData, "isMarketing") ?? false,
      required: readCheckbox(formData, "required") ?? false,
    });
    if (!parsed.success) return fail("O consentimento não foi adicionado.", zodFieldErrors(parsed.error));

    const existing = await prisma.consentDefinition.findMany({
      where: { leadFormId: owned.leadForm.id },
      select: { order: true },
    });
    const nextOrder = existing.reduce((max, c) => Math.max(max, c.order), -1) + 1;

    const consent = await prisma.consentDefinition.create({
      data: {
        leadFormId: owned.leadForm.id,
        text: parsed.data.text,
        version: 1,
        isMarketing: parsed.data.isMarketing,
        required: parsed.data.required,
        order: nextOrder,
      },
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "ConsentDefinition",
      entityId: consent.id,
      result: "SUCCESS",
      metadata: { isMarketing: consent.isMarketing, required: consent.required },
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok("Consentimento adicionado.");
  });
}

export async function updateConsentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateConsent", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const consentId = readOptional(formData, "consentId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    const consent = await prisma.consentDefinition.findFirst({
      where: { id: consentId, leadFormId: owned.leadForm.id },
    });
    if (!consent) notFound();

    // O que não vier no envio entra com o valor gravado, e o schema valida o
    // consentimento tal como vai ficar (marketing e obrigatório juntos não).
    const storedText = normalizeNewlines(consent.text);
    const parsed = consentSchema.safeParse({
      text: readOptional(formData, "text") ?? storedText,
      isMarketing: readCheckbox(formData, "isMarketing") ?? consent.isMarketing,
      required: readCheckbox(formData, "required") ?? consent.required,
    });
    if (!parsed.success) return fail("O consentimento não foi guardado.", zodFieldErrors(parsed.error));

    // Texto novo = versão nova: cada ConsentRecord guarda a versão que o
    // participante viu. Só as mudanças de linha (CRLF gravado antes) não
    // contam como texto novo.
    const textChanged = parsed.data.text !== storedText.trim();
    const versionAfter = textChanged ? consent.version + 1 : consent.version;

    await prisma.consentDefinition.update({
      where: { id: consent.id },
      data: {
        text: textChanged ? parsed.data.text : undefined,
        version: versionAfter,
        isMarketing: parsed.data.isMarketing,
        required: parsed.data.required,
      },
    });

    // Consentimentos são dados relevantes para o RGPD (secção 24) — auditar
    // sempre que o texto (nova versão) ou o carácter de marketing/obrigatório
    // muda, não só na criação/remoção.
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "ConsentDefinition",
      entityId: consent.id,
      result: "SUCCESS",
      metadata: {
        versionBefore: consent.version,
        versionAfter,
        isMarketingBefore: consent.isMarketing,
        isMarketingAfter: parsed.data.isMarketing,
        requiredBefore: consent.required,
        requiredAfter: parsed.data.required,
      },
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok(textChanged ? `Guardado — versão ${versionAfter}.` : "Guardado.");
  });
}

export async function removeConsentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeConsent", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const consentId = readOptional(formData, "consentId") ?? "";
    const owned = await getOwnedLeadForm(context.organizationId, campaignId);
    if (!owned) notFound();

    const consent = await prisma.consentDefinition.findFirst({
      where: { id: consentId, leadFormId: owned.leadForm.id },
      select: { id: true, _count: { select: { consentRecords: true } } },
    });
    if (!consent) return fail(CONSENT_GONE_MESSAGE);

    // O registo de cada consentimento dado aponta para a definição (RESTRICT):
    // é a prova do que o participante aceitou e não pode ficar órfão.
    if (consent._count.consentRecords > 0) return fail(CONSENT_IN_USE_MESSAGE);

    try {
      await prisma.consentDefinition.delete({ where: { id: consent.id } });
    } catch (error) {
      // Aceite entre a contagem e a remoção.
      if (databaseErrorKind(error) === "foreign_key") return fail(CONSENT_IN_USE_MESSAGE);
      throw error;
    }

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "ConsentDefinition",
      entityId: consent.id,
      result: "SUCCESS",
    });

    revalidatePath(formPath(owned.campaign.id));
    return ok();
  });
}
