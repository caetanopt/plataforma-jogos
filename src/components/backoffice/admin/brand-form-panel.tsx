import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/**
 * Cartão de um formulário de criação (convidar um utilizador, novo espaço de
 * trabalho): à esquerda a superfície de marca com o título, à direita o
 * formulário. Abaixo de `xl` fica um por cima do outro (num portátil de 1024 px
 * a coluna da marca deixava o formulário apertado).
 *
 * É o destaque da página — usar no máximo um por página.
 *
 * A luz que se move fica só na metade de baixo e só a partir de `xl`, quando
 * há espaço vazio por baixo do título: o contraste do texto branco nunca
 * depende da animação.
 */
export function BrandFormPanel({
  headingId,
  title,
  description,
  icon,
  children,
}: {
  /** Id do `<h2>`, que dá nome à secção. */
  headingId: string;
  title: string;
  description?: string;
  /** Ícone decorativo (lucide). */
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      as="section"
      aria-labelledby={headingId}
      padding="none"
      className="overflow-hidden shadow-sm xl:grid xl:grid-cols-[19rem_minmax(0,1fr)]"
    >
      <div className="surface-brand relative isolate overflow-hidden px-5 py-6 sm:px-6 xl:px-8 xl:py-8">
        <div aria-hidden="true" className="absolute inset-0 -z-10 hidden overflow-hidden xl:block">
          <div className="absolute inset-x-0 bottom-0 h-1/2">
            <div className="brand-aurora" />
          </div>
          <span className="brand-streak top-[84%]" />
          <span className="brand-streak top-[92%] [animation-delay:2.6s] [animation-duration:9s]" />
        </div>

        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-caetano-deep-blue shadow-md"
        >
          {icon}
        </span>
        <h2 id={headingId} className="mt-4 text-lg font-bold leading-snug text-white sm:text-xl">
          {title}
        </h2>
        {description && <p className="mt-1.5 text-sm font-light text-caetano-cyan-20">{description}</p>}
      </div>

      <div className="p-5 sm:p-6 xl:p-8">{children}</div>
    </Card>
  );
}
