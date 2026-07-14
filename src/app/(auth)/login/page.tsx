import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { loginAction } from "@/features/auth/actions";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou password inválidos.",
  reset_token_invalid: "O link de recuperação é inválido ou expirou.",
  no_organization: "A sua conta não está associada a nenhuma organização.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? "Ocorreu um erro." : null;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-caetano-anthracite">Entrar</h1>
      <p className="mb-6 text-sm text-caetano-medium-gray">
        Acesso à plataforma de jogos interativos.
      </p>

      <div className="mb-4 space-y-3">
        {errorMessage && <Alert variant="error">{errorMessage}</Alert>}
        {params.reset === "success" && (
          <Alert variant="success">Password alterada com sucesso. Pode entrar.</Alert>
        )}
      </div>

      <form action={loginAction} className="space-y-4">
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full">
          Entrar
        </Button>
      </form>

      <Link
        href="/forgot-password"
        className="mt-4 block text-center text-sm text-caetano-cyan hover:underline"
      >
        Esqueceu a password?
      </Link>
    </div>
  );
}
