"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface PublicLeadField {
  id: string;
  internalKey: string;
  type: string;
  label: string;
  placeholder: string | null;
  helpText: string | null;
  required: boolean;
  options: string[] | null;
}

export interface PublicConsentDefinition {
  id: string;
  text: string;
  required: boolean;
}

interface PublicLeadFormProps {
  fields: PublicLeadField[];
  consents: PublicConsentDefinition[];
  honeypotEnabled: boolean;
  submitLabel?: string;
  onSubmit: (
    values: Record<string, string>,
    consents: Record<string, boolean>,
    honeypot: string,
  ) => Promise<{ ok: boolean; reason?: string }>;
}

function fieldInputType(type: string): string {
  switch (type) {
    case "EMAIL":
      return "email";
    case "PHONE":
      return "tel";
    case "BIRTH_DATE":
    case "DATE":
      return "date";
    default:
      return "text";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "Verifique os campos obrigatórios e tente novamente.",
  duplicate: "Já detetámos uma participação anterior com estes dados.",
};

export function PublicLeadForm({
  fields,
  consents,
  honeypotEnabled,
  submitLabel = "Continuar",
  onSubmit,
}: PublicLeadFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [consentValues, setConsentValues] = useState<Record<string, boolean>>({});
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await onSubmit(values, consentValues, honeypot);
    if (!result.ok) {
      setError(ERROR_MESSAGES[result.reason ?? "invalid"] ?? ERROR_MESSAGES.invalid);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-caetano-medium-gray/30 bg-white p-6">
      {honeypotEnabled && (
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="website">Não preencher</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>
      )}

      {fields.map((field) => (
        <div key={field.id}>
          <label htmlFor={field.id} className="mb-1.5 block text-sm font-medium text-caetano-anthracite">
            {field.label}
            {field.required && <span className="text-red-600"> *</span>}
          </label>

          {field.type === "LONG_TEXT" ? (
            <textarea
              id={field.id}
              required={field.required}
              placeholder={field.placeholder ?? undefined}
              rows={3}
              className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            />
          ) : field.type === "SINGLE_CHOICE" || field.type === "DROPDOWN" ? (
            <select
              id={field.id}
              required={field.required}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            >
              <option value="">Selecione…</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.type === "CHECKBOX" ? (
            <input
              id={field.id}
              type="checkbox"
              required={field.required}
              className="h-4 w-4 rounded border-caetano-medium-gray"
              checked={values[field.internalKey] === "true"}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [field.internalKey]: e.target.checked ? "true" : "false" }))
              }
            />
          ) : (
            <input
              id={field.id}
              type={fieldInputType(field.type)}
              required={field.required}
              placeholder={field.placeholder ?? undefined}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            />
          )}
          {field.helpText && <p className="mt-1 text-xs text-caetano-medium-gray">{field.helpText}</p>}
        </div>
      ))}

      {consents.map((consent) => (
        <label key={consent.id} className="flex items-start gap-2 text-sm text-caetano-anthracite">
          <input
            type="checkbox"
            required={consent.required}
            checked={consentValues[consent.id] ?? false}
            onChange={(e) => setConsentValues((prev) => ({ ...prev, [consent.id]: e.target.checked }))}
            className="mt-0.5 h-4 w-4 rounded border-caetano-medium-gray"
          />
          <span>
            {consent.text}
            {consent.required && <span className="text-red-600"> *</span>}
          </span>
        </label>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className={cn(
          "w-full rounded-lg bg-caetano-deep-blue px-4 py-2.5 font-medium text-white disabled:opacity-60",
        )}
      >
        {submitting ? "A enviar…" : submitLabel}
      </button>
    </form>
  );
}
