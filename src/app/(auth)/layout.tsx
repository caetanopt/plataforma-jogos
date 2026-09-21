import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { BrandLogo } from "@/components/backoffice/brand-logo";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-caetano-deep-blue px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Antes de haver sessão não se sabe a que organização o utilizador
            pertence, por isso não há logótipo oficial a resolver — mostra-se
            só o nome do produto, nunca o wordmark composto com uma fonte. */}
        <div className="mb-8 flex justify-center">
          <BrandLogo size="lg" onDark />
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-lg">{children}</div>
      </div>
    </div>
  );
}
