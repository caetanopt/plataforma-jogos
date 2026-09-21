"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2 } from "lucide-react";

/** Quanto tempo a confirmação fica visível depois de gravar. */
const CONFIRMATION_MS = 2500;

/**
 * Estado da gravação automática do editor.
 *
 * Antes mostrava "A guardar…" e depois cadeia vazia: o utilizador via a
 * mensagem desaparecer sem nunca saber se a gravação tinha resultado. Agora
 * confirma, e a confirmação desvanece-se.
 */
export function SaveStatus() {
  const { pending } = useFormStatus();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    // A transição pendente -> não pendente é o momento em que gravou.
    if (wasPending.current && !pending) setSavedAt(Date.now());
    wasPending.current = pending;
  }, [pending]);

  useEffect(() => {
    if (savedAt == null) return;
    const timer = setTimeout(() => setSavedAt(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [savedAt]);

  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80"
    >
      {pending && (
        <>
          <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />
          A guardar…
        </>
      )}
      {!pending && savedAt != null && (
        <>
          <Check size={12} aria-hidden="true" className="text-caetano-eco-green" />
          Alterações guardadas
        </>
      )}
    </span>
  );
}
