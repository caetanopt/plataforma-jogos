import Link from "next/link";
import { SubmitButton } from "@/components/ui/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { requestPasswordResetAction } from "@/features/auth/actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold text-caetano-anthracite">Recuperar password</h1>
      <p className="mb-6 text-sm text-caetano-anthracite-80">
        Introduza o seu e-mail para receber um link de recuperação.
      </p>

      {params.sent ? (
        <Alert variant="success">
          Se existir uma conta com esse e-mail, enviámos um link de recuperação. Verifique a sua
          caixa de entrada.
        </Alert>
      ) : (
        <form action={requestPasswordResetAction} className="space-y-4">
          <div>
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <SubmitButton pendingLabel="A enviar…" className="w-full">
            Enviar link de recuperação
          </SubmitButton>
        </form>
      )}

      <Link href="/login" className="mt-4 block text-center text-sm text-caetano-deep-blue hover:underline">
        Voltar a entrar
      </Link>
    </div>
  );
}
