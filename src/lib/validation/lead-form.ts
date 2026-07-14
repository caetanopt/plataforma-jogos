import { z } from "zod";

export const leadFormPositionSchema = z.enum([
  "BEFORE_GAME",
  "AFTER_GAME",
  "BEFORE_RESULT",
  "BEFORE_PRIZE",
  "NONE",
]);

export const leadFieldTypeSchema = z.enum([
  "FIRST_NAME",
  "LAST_NAME",
  "FULL_NAME",
  "EMAIL",
  "PHONE",
  "BIRTH_DATE",
  "POSTAL_CODE",
  "CITY",
  "COUNTRY",
  "COMPANY",
  "JOB_TITLE",
  "CUSTOMER_NUMBER",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "SHORT_TEXT",
  "LONG_TEXT",
  "DROPDOWN",
  "DATE",
  "CHECKBOX",
  "HIDDEN",
  "CONSENT",
  "TERMS_ACCEPTANCE",
]);

export const dedupStrategySchema = z.enum([
  "EMAIL",
  "PHONE",
  "COOKIE",
  "SESSION",
  "IP",
  "CODE",
  "FIELD_COMBINATION",
]);

export const leadFormSettingsSchema = z.object({
  position: leadFormPositionSchema,
  honeypotEnabled: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  dedupStrategies: z.array(dedupStrategySchema).default([]),
});

export const addLeadFieldSchema = z.object({
  type: leadFieldTypeSchema,
  label: z.string().trim().min(1, "O label é obrigatório.").max(150),
});

const CHOICE_FIELD_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "DROPDOWN"];

export const updateLeadFieldSchema = z.object({
  label: z.string().trim().min(1).max(150),
  placeholder: z.string().trim().max(150).optional().or(z.literal("")),
  helpText: z.string().trim().max(300).optional().or(z.literal("")),
  required: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  validationRegex: z.string().trim().max(300).optional().or(z.literal("")),
  defaultValue: z.string().trim().max(300).optional().or(z.literal("")),
  options: z.string().trim().max(2000).optional().or(z.literal("")),
  exportMapping: z.string().trim().max(150).optional().or(z.literal("")),
});

export function fieldTypeHasOptions(type: string): boolean {
  return CHOICE_FIELD_TYPES.includes(type);
}

export const addConsentSchema = z.object({
  text: z.string().trim().min(1, "O texto é obrigatório.").max(3000),
  isMarketing: z.union([z.literal("on"), z.literal(""), z.undefined()]),
  required: z.union([z.literal("on"), z.literal(""), z.undefined()]),
});
