import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Definir password" };

/**
 * Os links de recuperação e de convite trazem o token no fragmento
 * (/reset-password#t=...), que o browser não envia ao servidor — fica fora
 * dos logs de pedidos. O formulário lê-o no browser.
 */
export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-caetano-deep-blue sm:text-[2rem]">Definir password</h1>
      <p className="mb-8 text-base font-light text-caetano-anthracite-80">Escolha uma nova password para a sua conta.</p>
      <ResetPasswordForm />
    </div>
  );
}
