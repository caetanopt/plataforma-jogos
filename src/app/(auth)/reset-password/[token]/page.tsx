import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Definir password" };

/**
 * Formato antigo dos links (/reset-password/<token>), mantido para os
 * convites já enviados (válidos até 7 dias). Os links novos usam o
 * fragmento — ver ../page.tsx.
 */
export default async function LegacyResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div>
      <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-caetano-deep-blue sm:text-[2rem]">Definir password</h1>
      <p className="mb-8 text-base font-light text-caetano-anthracite-80">Escolha uma nova password para a sua conta.</p>
      <ResetPasswordForm legacyToken={token} />
    </div>
  );
}
