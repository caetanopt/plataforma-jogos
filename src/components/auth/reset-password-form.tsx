"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { resetPasswordAction, type ResetPasswordState } from "@/features/auth/actions";

const ERROR_MESSAGES: Record<NonNullable<ResetPasswordState["error"]>, string> = {
  validation: "A password deve ter pelo menos 10 caracteres e as duas entradas devem coincidir.",
};

/** Lê o token de `#t=<token>` — o fragmento nunca chega ao servidor. */
function tokenFromHash(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get("t");
}

export function ResetPasswordForm({ legacyToken }: { legacyToken?: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, { error: null });
  const tokenInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (legacyToken) return;
    const token = tokenFromHash();
    if (token && tokenInput.current) {
      tokenInput.current.value = token;
      // Tira o token da barra de endereço e do histórico do browser.
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [legacyToken]);

  return (
    <>
      {state.error && (
        <div className="mb-4">
          <Alert variant="error">{ERROR_MESSAGES[state.error]}</Alert>
        </div>
      )}

      <form action={formAction} className="space-y-4">
        <input ref={tokenInput} type="hidden" name="token" defaultValue={legacyToken ?? ""} />
        <div>
          <Label htmlFor="password">Nova password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </div>
        <div>
          <Label htmlFor="confirmPassword">Confirmar password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </div>
        <SubmitButton pendingLabel="A guardar…" className="w-full">
          Guardar password
        </SubmitButton>
      </form>
    </>
  );
}
