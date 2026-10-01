import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { resolveOrgContext } from "@/server/auth/session";
import { BrandLogo } from "@/components/backoffice/brand-logo";
import { BrandClaim } from "@/components/backoffice/nav-list";

/**
 * Entrada no backoffice: à esquerda (em baixo no telemóvel, por cima) a
 * superfície de marca — o azul profundo com a luz do azul cyan, como os
 * fundos do Brand Book (08.9, 09.4) — e o claim; à direita o formulário, num
 * cartão branco.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  // Só quem tem um contexto válido segue para o backoffice. Com "tem sessão"
  // bastava, um utilizador sem organização, desativado ou de uma organização
  // suspensa ficava num ciclo /folders -> /login -> /folders.
  const context = await resolveOrgContext();
  if (context.ok) {
    redirect("/folders");
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-white lg:flex-row">
      <section
        aria-label="Plataforma de Jogos"
        className="surface-brand relative isolate flex shrink-0 flex-col justify-between overflow-hidden px-6 py-8 sm:px-10 lg:min-h-dvh lg:w-[46%] lg:px-14 lg:py-12"
      >
        {/* Decoração: luz que se move devagar e traços de velocidade. */}
        <div aria-hidden="true" className="absolute inset-0 -z-10 overflow-hidden">
          <div className="brand-aurora" />
          <span className="brand-streak top-[62%]" />
          <span className="brand-streak top-[70%] [animation-delay:2.4s] [animation-duration:9s]" />
          <span className="brand-streak top-[78%] [animation-delay:4.1s]" />
        </div>
        {/* Antes de haver sessão não se sabe a que organização o utilizador
            pertence, por isso não há logótipo oficial a resolver — mostra-se
            só o nome do produto, nunca o wordmark composto com uma fonte. */}
        <BrandLogo size="lg" onDark />
        <div className="mt-10 max-w-md lg:mt-0">
          <p className="text-2xl font-bold leading-tight sm:text-3xl lg:text-[2.75rem] lg:leading-[1.1]">
            Campanhas interativas,
            <span className="block font-light text-caetano-cyan-20">leads com confiança.</span>
          </p>
          <p className="mt-4 hidden max-w-sm text-base font-light text-caetano-deep-blue-20 sm:block">
            Jogos da Memória, Rodas da Sorte e Quizzes com a identidade da marca, publicados em minutos.
          </p>
        </div>
        <BrandClaim className="mt-8 hidden text-base lg:block" />
      </section>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:px-8 lg:items-center">
        <div className="w-full max-w-sm animate-enter">{children}</div>
      </main>
    </div>
  );
}
