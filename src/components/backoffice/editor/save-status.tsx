"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { fieldErrorId, useFormAction } from "@/components/forms/form-action-context";
import type { ActionResult } from "@/lib/forms/action-result";

/** Quanto tempo a confirmação fica visível depois de gravar. */
const CONFIRMATION_MS = 2500;

/**
 * Mostra a confirmação de sucesso durante uns segundos a cada nova resposta
 * (o `at` muda mesmo que a mensagem se repita).
 */
function useRecentSuccess(result: ActionResult): boolean {
  const [shownAt, setShownAt] = useState<number | null>(null);
  const [lastAt, setLastAt] = useState(0);

  if (result.status === "success" && result.at !== lastAt) {
    setLastAt(result.at);
    setShownAt(result.at);
  }

  useEffect(() => {
    if (shownAt == null) return;
    const timer = setTimeout(() => setShownAt(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [shownAt]);

  return shownAt != null;
}

/**
 * Erro de uma gravação: a mensagem e, por campo, uma linha com o id que o
 * input referencia em `aria-describedby`. Fica até à próxima gravação bem
 * sucedida.
 */
function ErrorDetails({ result, idPrefix }: { result: Extract<ActionResult, { status: "error" }>; idPrefix: string }) {
  const entries = Object.entries(result.fieldErrors).filter(([name]) => name !== "_form");
  const formLevel = result.fieldErrors._form;

  return (
    <div role="alert" className="flex items-start gap-1.5 text-xs text-danger-strong">
      <AlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />
      <div>
        <p className="font-medium">{result.message}</p>
        {formLevel && <p>{formLevel}</p>}
        {entries.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">
            {entries.map(([name, message]) => (
              <li key={name} id={fieldErrorId(idPrefix, name)}>
                {message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Estado da gravação automática do editor.
 *
 * Antes lia o `useFormStatus` e dizia "Alterações guardadas" em qualquer
 * fim de pedido, mesmo quando o servidor tinha recusado tudo. Agora mostra o
 * que a ação respondeu: a gravar, um upload em curso, o erro (que fica
 * visível até a gravação seguinte correr bem) ou a confirmação, que
 * desvanece.
 */
export function SaveStatus() {
  const context = useFormAction();
  const recentSuccess = useRecentSuccess(context?.result ?? { status: "idle" });
  if (!context) return null;
  const { result, isPending, uploading, idPrefix } = context;

  return (
    <div className="space-y-1">
      <span aria-live="polite" className="inline-flex min-h-4 items-center gap-1.5 text-xs text-caetano-anthracite-80">
        {uploading ? (
          <>
            <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />
            A carregar ficheiro…
          </>
        ) : isPending ? (
          <>
            <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />
            A guardar…
          </>
        ) : result.status === "success" && recentSuccess ? (
          <>
            <Check size={12} aria-hidden="true" className="text-caetano-eco-green" />
            {result.message ?? "Alterações guardadas"}
          </>
        ) : null}
      </span>
      {result.status === "error" && <ErrorDetails result={result} idPrefix={idPrefix} />}
    </div>
  );
}

/**
 * Resposta de um formulário simples (adicionar, editar, remover): o erro no
 * sítio do formulário e, quando a ação a dá, uma confirmação. Sem nada para
 * dizer não ocupa espaço (há formulários de um só botão numa linha).
 */
export function FormMessage({ className }: { className?: string }) {
  const context = useFormAction();
  const recentSuccess = useRecentSuccess(context?.result ?? { status: "idle" });
  if (!context) return null;
  const { result, idPrefix } = context;

  if (result.status === "error") {
    return (
      <div className={className}>
        <ErrorDetails result={result} idPrefix={idPrefix} />
      </div>
    );
  }
  if (result.status === "success" && result.message && recentSuccess) {
    return (
      <p role="status" className={`inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80 ${className ?? ""}`}>
        <Check size={12} aria-hidden="true" className="text-caetano-eco-green" />
        {result.message}
      </p>
    );
  }
  return null;
}
