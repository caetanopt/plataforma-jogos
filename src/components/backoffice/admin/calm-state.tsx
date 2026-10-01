import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Estado de página inteira (sem permissão, erro): um cartão centrado, com o
 * ícone no quadrado de marca e o título da página. Calmo de propósito — o
 * utilizador não fez nada de errado, só precisa de saber o que aconteceu e
 * por onde seguir.
 *
 * Sem hooks: serve a páginas do servidor e à fronteira de erro (cliente).
 */
export function CalmState({
  icon,
  title,
  description,
  children,
}: {
  /** Ícone decorativo (lucide). */
  icon: ReactNode;
  title: string;
  description: string;
  /** Ações e detalhes por baixo do texto. */
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4 py-10 sm:p-6 md:p-8">
      <Card padding="none" className="relative isolate w-full max-w-xl overflow-hidden shadow-md">
        {/* A luz do azul cyan a nascer do topo, por trás do ícone. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 -z-10 h-56 bg-[radial-gradient(75%_100%_at_50%_0%,var(--color-caetano-cyan-20),var(--color-caetano-ultra-white)_75%)]"
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-caetano-deep-blue via-caetano-cyan to-caetano-sky"
        />

        <div className="flex flex-col items-center px-5 py-10 text-center sm:px-10 sm:py-12">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-135 from-caetano-deep-blue to-caetano-cyan text-white shadow-md ring-8 ring-white motion-safe:animate-scale-in"
          >
            {icon}
          </span>

          <PageHeader
            title={title}
            description={description}
            className="mt-6 mb-0 items-center sm:mb-0 sm:flex-col sm:items-center sm:justify-center [&_h1]:text-balance [&_p]:mx-auto [&_p]:mt-3 [&_p]:text-pretty"
          />

          {children && <div className="mt-7 flex w-full flex-col items-center gap-4">{children}</div>}
        </div>
      </Card>
    </div>
  );
}
