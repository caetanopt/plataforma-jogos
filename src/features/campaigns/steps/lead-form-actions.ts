"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import {
  addConsentSchema,
  addLeadFieldSchema,
  leadFormSettingsSchema,
  updateLeadFieldSchema,
} from "@/lib/validation/lead-form";
import { slugify } from "@/lib/random/slug";

async function getOwnedLeadForm(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { leadForm: true },
  });
  return campaign?.leadForm ? { campaign, leadForm: campaign.leadForm } : null;
}

export async function updateLeadFormSettingsAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = leadFormSettingsSchema.safeParse({
    position: formData.get("position"),
    honeypotEnabled: formData.get("honeypotEnabled") ?? "",
    dedupStrategies: formData.getAll("dedupStrategies"),
  });
  if (!parsed.success) return;

  await prisma.leadForm.update({
    where: { id: owned.leadForm.id },
    data: {
      position: parsed.data.position,
      honeypotEnabled: parsed.data.honeypotEnabled === "on",
    },
  });

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { dedupStrategies: parsed.data.dedupStrategies },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function addLeadFieldAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = addLeadFieldSchema.safeParse({
    type: formData.get("type"),
    label: formData.get("label"),
  });
  if (!parsed.success) return;

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

  await prisma.leadFormField.create({
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
    entityId: owned.leadForm.id,
    result: "SUCCESS",
    metadata: { type: parsed.data.type },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function updateLeadFieldAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const field = await prisma.leadFormField.findFirst({
    where: { id: fieldId, leadFormId: owned.leadForm.id },
  });
  if (!field) notFound();

  const parsed = updateLeadFieldSchema.safeParse({
    label: formData.get("label"),
    placeholder: formData.get("placeholder"),
    helpText: formData.get("helpText"),
    required: formData.get("required") ?? "",
    validationRegex: formData.get("validationRegex"),
    defaultValue: formData.get("defaultValue"),
    options: formData.get("options"),
    exportMapping: formData.get("exportMapping"),
  });
  if (!parsed.success) return;

  const options = parsed.data.options
    ? parsed.data.options
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : undefined;

  await prisma.leadFormField.update({
    where: { id: fieldId },
    data: {
      label: parsed.data.label,
      placeholder: parsed.data.placeholder || null,
      helpText: parsed.data.helpText || null,
      required: parsed.data.required === "on",
      validationRegex: parsed.data.validationRegex || null,
      defaultValue: parsed.data.defaultValue || null,
      options: options ?? undefined,
      exportMapping: parsed.data.exportMapping || null,
    },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function removeLeadFieldAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  await prisma.leadFormField.deleteMany({ where: { id: fieldId, leadFormId: owned.leadForm.id } });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function moveLeadFieldAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const fieldId = String(formData.get("fieldId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const fields = await prisma.leadFormField.findMany({
    where: { leadFormId: owned.leadForm.id },
    orderBy: { order: "asc" },
  });
  const index = fields.findIndex((f) => f.id === fieldId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= fields.length) return;

  const current = fields[index];
  const swapWith = fields[swapIndex];

  await prisma.$transaction([
    prisma.leadFormField.update({ where: { id: current.id }, data: { order: swapWith.order } }),
    prisma.leadFormField.update({ where: { id: swapWith.id }, data: { order: current.order } }),
  ]);

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function addConsentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = addConsentSchema.safeParse({
    text: formData.get("text"),
    isMarketing: formData.get("isMarketing") ?? "",
    required: formData.get("required") ?? "",
  });
  if (!parsed.success) return;

  const existing = await prisma.consentDefinition.findMany({
    where: { leadFormId: owned.leadForm.id },
    select: { order: true },
  });
  const nextOrder = existing.reduce((max, c) => Math.max(max, c.order), -1) + 1;

  await prisma.consentDefinition.create({
    data: {
      leadFormId: owned.leadForm.id,
      text: parsed.data.text,
      version: 1,
      isMarketing: parsed.data.isMarketing === "on",
      required: parsed.data.required === "on",
      order: nextOrder,
    },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function updateConsentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const consentId = String(formData.get("consentId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  const consent = await prisma.consentDefinition.findFirst({
    where: { id: consentId, leadFormId: owned.leadForm.id },
  });
  if (!consent) notFound();

  const parsed = addConsentSchema.safeParse({
    text: formData.get("text"),
    isMarketing: formData.get("isMarketing") ?? "",
    required: formData.get("required") ?? "",
  });
  if (!parsed.success) return;

  const textChanged = parsed.data.text !== consent.text;

  await prisma.consentDefinition.update({
    where: { id: consentId },
    data: {
      text: parsed.data.text,
      version: textChanged ? consent.version + 1 : consent.version,
      isMarketing: parsed.data.isMarketing === "on",
      required: parsed.data.required === "on",
    },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}

export async function removeConsentAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = String(formData.get("campaignId") ?? "");
  const consentId = String(formData.get("consentId") ?? "");
  const owned = await getOwnedLeadForm(context.organizationId, campaignId);
  if (!owned) notFound();

  await prisma.consentDefinition.deleteMany({
    where: { id: consentId, leadFormId: owned.leadForm.id },
  });

  revalidatePath(`/apps/${campaignId}/formulario`);
}
