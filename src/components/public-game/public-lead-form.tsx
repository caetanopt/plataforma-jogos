"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CircleAlert, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ForwardArrow, gameButtonClass, gameCardClass, Spinner, stageEnterClass } from "@/components/public-game/game-ui";
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
  /** Informação legal (RGPD) junto ao botão de envio. */
  privacyNotice?: ReactNode;
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

/*
  Campos com 48 px de altura e texto de 16 px (num telemóvel, abaixo disso o
  browser amplia a página ao focar). O placeholder do Tailwind é o texto a
  50% de opacidade (2,7:1 no tema por omissão): uma cor do tema que se lê.
*/
const fieldClass = cn(
  "w-full rounded-game border border-game-border-strong bg-game-surface px-4 text-base text-game-text placeholder:text-game-muted",
  "shadow-(--game-elevation-sm) transition-[border-color,box-shadow] duration-150",
  "hover:border-game-accent focus-visible:border-game-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-game-accent",
  "aria-invalid:border-game-danger",
);

// A caixa nativa, na cor de destaque do tema e com um alvo de 20 px.
const checkboxClass = "size-5 shrink-0 cursor-pointer rounded border-game-border-strong accent-game-accent";

export function PublicLeadForm({
  fields,
  consents,
  honeypotEnabled,
  submitLabel = "Continuar",
  intro,
  privacyNotice,
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
      className={cn(
        "relative space-y-5 p-6 outline-none focus-visible:ring-2 focus-visible:ring-game-accent sm:p-8",
        gameCardClass,
        stageEnterClass,
      )}
    >
      {intro && (
        <p className="flex items-start gap-3 text-lg font-bold leading-snug text-game-text">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-game-highlight text-game-highlight-text"
          >
            <Sparkles className="size-4" />
          </span>
          <span className="pt-1">{intro}</span>
        </p>
      )}
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
          <label htmlFor={field.id} className="mb-2 block text-sm font-medium text-game-text">
            {field.label}
            {field.required && <span className="text-game-danger"> *</span>}
          </label>

          {field.type === "LONG_TEXT" ? (
            <textarea
              id={field.id}
              required={field.required}
              placeholder={field.placeholder ?? undefined}
              rows={3}
              className={cn(fieldClass, "min-h-28 py-3 leading-relaxed")}
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            />
          ) : field.type === "SINGLE_CHOICE" || field.type === "DROPDOWN" ? (
            <div className="relative">
              <select
                id={field.id}
                aria-required={field.required || undefined}
                aria-describedby={field.helpText ? `${field.id}-help` : undefined}
                required={field.required}
                className={cn(fieldClass, "h-12 cursor-pointer appearance-none pr-11")}
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
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-game-muted"
              />
            </div>
          ) : field.type === "CHECKBOX" ? (
            <input
              id={field.id}
              type="checkbox"
              required={field.required}
              aria-required={field.required || undefined}
              aria-describedby={field.helpText ? `${field.id}-help` : undefined}
              className={checkboxClass}
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
              className={cn(fieldClass, "h-12")}
              value={values[field.internalKey] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [field.internalKey]: e.target.value }))}
            />
          )}
          {field.helpText && (
            <p id={`${field.id}-help`} className="mt-1.5 text-xs leading-relaxed text-game-muted">
              {field.helpText}
            </p>
          )}
        </div>
      ))}

      {consents.length > 0 && (
        <div className="space-y-2.5">
          {consents.map((consent) => (
            // A linha toda é clicável; escolhida, ganha o contorno da cor de destaque.
            <label
              key={consent.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-game border border-game-border px-4 py-3 text-sm leading-snug text-game-text",
                "transition-[border-color,box-shadow] duration-150 hover:border-game-border-strong",
                "has-checked:border-game-accent has-checked:shadow-[inset_0_0_0_1px_var(--game-accent)]",
              )}
            >
              <input
                type="checkbox"
                required={consent.required}
                checked={consentValues[consent.id] ?? false}
                onChange={(e) => setConsentValues((prev) => ({ ...prev, [consent.id]: e.target.checked }))}
                className={cn(checkboxClass, "mt-px")}
              />
              <span>
                {consent.text}
                {consent.required && <span className="text-game-danger"> *</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      {privacyNotice}

      {error && (
        <p
          id="lead-form-error"
          role="alert"
          className="flex items-start gap-2 rounded-game border border-game-danger px-3 py-2.5 text-sm text-game-danger motion-safe:animate-fade-in"
        >
          <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting || undefined}
        className={gameButtonClass({ size: "lg", className: "group w-full disabled:cursor-progress" })}
      >
        {submitting && <Spinner />}
        <span>{submitting ? "A enviar…" : submitLabel}</span>
        {!submitting && <ForwardArrow />}
      </button>
    </form>
  );
}
