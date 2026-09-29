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
  // O token fica numa ref e é juntado no envio. Antes ia num input hidden
  // alterado pelo DOM: depois de um erro de validação o React repunha o
  // defaultValue (vazio), o hash já tinha sido apagado, e todos os envios
  // seguintes falhavam — o utilizador ficava preso.
  const token = useRef(legacyToken ?? "");
  const [state, formAction] = useActionState(
    (previous: ResetPasswordState, formData: FormData) => {
      formData.set("token", token.current);
      return resetPasswordAction(previous, formData);
    },
    { error: null },
  );

  useEffect(() => {
    if (legacyToken) return;
    const fromHash = tokenFromHash();
    if (fromHash) {
      token.current = fromHash;
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
