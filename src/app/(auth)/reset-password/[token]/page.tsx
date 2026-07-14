import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { resetPasswordAction } from "@/features/auth/actions";

const ERROR_MESSAGES: Record<string, string> = {
  validation: "A password deve ter pelo menos 10 caracteres e as duas entradas devem coincidir.",
};

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-caetano-anthracite">Definir password</h1>
      <p className="mb-6 text-sm text-caetano-medium-gray">
        Escolha uma nova password para a sua conta.
      </p>

      {error && (
        <div className="mb-4">
          <Alert variant="error">{ERROR_MESSAGES[error] ?? "Ocorreu um erro."}</Alert>
        </div>
      )}

      <form action={resetPasswordAction} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div>
          <Label htmlFor="password">Nova password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
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
        <Button type="submit" className="w-full">
          Guardar password
        </Button>
      </form>
    </div>
  );
}
