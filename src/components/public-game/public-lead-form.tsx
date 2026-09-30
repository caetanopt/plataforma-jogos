"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isPlausiblePhone } from "@/features/play/identity";
import type { PublicConsentDefinition, PublicLeadField } from "@/features/play/types";

export type { PublicConsentDefinition, PublicLeadField };

interface PublicLeadFormProps {
  fields: PublicLeadField[];
  consents: PublicConsentDefinition[];
  honeypotEnabled: boolean;
  submitLabel?: string;
  /** Frase de contexto no topo, ex.: porque é que o formulário aparece agora. */
  intro?: string;
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
  phone: "Indique um número de telefone válido.",
  prize_unavailable: "Os seus dados foram guardados, mas não foi possível mostrar o prémio. Tente novamente.",
  result_unavailable: "Os seus dados foram guardados, mas não foi possível mostrar o resultado. Tente novamente.",
};

export function PublicLeadForm({
  fields,
  consents,
  honeypotEnabled,
  submitLabel = "Continuar",
  intro,
  onSubmit,
}: PublicLeadFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [consentValues, setConsentValues] = useState<Record<string, boolean>>({});
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Campo de telefone recusado: o erro fica ligado a ele (§27).
  const [invalidFieldId, setInvalidFieldId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // O formulário substitui o ecrã anterior (ou aparece a meio do jogo) e o
  // botão que tinha o foco desaparece: sem isto, o foco caía no início da
  // página e um leitor de ecrã não anunciava nada (secção 27).
  useEffect(() => {
    formRef.current?.focus();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    // A mesma regra do servidor: 6 a 15 dígitos, com ou sem indicativo.
    const badPhone = fields.find(
      (field) => field.type === "PHONE" && values[field.internalKey]?.trim() && !isPlausiblePhone(values[field.internalKey]),
    );
    if (badPhone) {
      setInvalidFieldId(badPhone.id);
      setError(ERROR_MESSAGES.phone);
      document.getElementById(badPhone.id)?.focus();
      return;
    }
    setInvalidFieldId(null);
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(values, consentValues, honeypot);
      if (!result.ok) {
        const phoneField = result.reason === "phone" ? fields.find((field) => field.type === "PHONE") : undefined;
        setInvalidFieldId(phoneField?.id ?? null);
        setError(ERROR_MESSAGES[result.reason ?? "invalid"] ?? ERROR_MESSAGES.invalid);
        setSubmitting(false);
      }
      // Em caso de sucesso o componente é desmontado pelo fluxo do jogo, por
      // isso `submitting` fica como está de propósito — repor a false faria
      // o botão voltar a ficar clicável durante a transição.
    } catch (error) {
      // Sem este ramo, uma server action que rejeite deixava o botão preso em
      // "A enviar…" para sempre e o participante perdia a campanha.
      console.error("[lead-form] Falha ao submeter o formulário:", error);
      setError(ERROR_MESSAGES.invalid);
      setSubmitting(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      tabIndex={-1}
      aria-label={intro ?? "Formulário de participação"}
      className="space-y-4 rounded-xl border border-caetano-medium-gray-40 bg-white p-6 outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
    >
      {intro && <p className="font-medium text-caetano-anthracite">{intro}</p>}
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
            {field.required && <span className="text-danger"> *</span>}
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
              aria-required={field.required || undefined}
              aria-describedby={field.helpText ? `${field.id}-help` : undefined}
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
              aria-required={field.required || undefined}
              aria-describedby={field.helpText ? `${field.id}-help` : undefined}
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
              aria-required={field.required || undefined}
              aria-invalid={invalidFieldId === field.id || undefined}
              aria-describedby={
                [field.helpText ? `${field.id}-help` : null, invalidFieldId === field.id ? "lead-form-error" : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              inputMode={field.type === "PHONE" ? "tel" : undefined}
              autoComplete={field.type === "PHONE" ? "tel" : field.type === "EMAIL" ? "email" : undefined}
              placeholder={field.placeholder ?? undefined}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm focus-visible:border-caetano-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            />
          )}
          {field.helpText && (
            <p id={`${field.id}-help`} className="mt-1 text-xs text-caetano-anthracite-80">
              {field.helpText}
            </p>
          )}
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
            {consent.required && <span className="text-danger"> *</span>}
          </span>
        </label>
      ))}

      {error && (
        <p id="lead-form-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

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
