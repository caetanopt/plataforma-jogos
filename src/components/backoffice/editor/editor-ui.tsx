import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { controlClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { selectClass, SelectShell } from "@/components/ui/select";

/*
  Peças de apresentação das etapas do editor. Só classes e marcação: os
  formulários (AutoSaveForm, ActionForm) e os nomes dos campos ficam onde
  estavam.

  A hierarquia segue o Brand Book (02.1, 04.1): títulos em Montserrat Bold no
  azul profundo e, logo abaixo, uma linha mais leve. O texto secundário fica
  no antracite -80 (6,1:1 sobre branco), nunca num tom mais claro.
*/

/** Largura e ritmo do conteúdo de cada etapa: o mesmo em todas, para nada saltar ao mudar de etapa. */
export const STEP_CONTENT_CLASS = "max-w-3xl space-y-6 sm:space-y-8";

/** Cartão de uma secção da etapa (o mesmo aspeto do `Card`, para formulários que são o próprio cartão). */
export const STEP_CARD_CLASS =
  "rounded-2xl border border-caetano-medium-gray-40 bg-white p-4 shadow-xs sm:p-6";

/** Linha de ajuda por baixo de um campo. */
export const HELP_CLASS = "mt-1.5 text-xs leading-relaxed text-caetano-anthracite-80";

/** `<select>` nativo com o aspeto do `Input`; a seta é a do `SelectShell` (ui/select). */
export const SELECT_CLASS = selectClass;
export { SelectShell };

/** `<textarea>` com o aspeto do `Input` (a altura vem de `rows`). */
export const TEXTAREA_CLASS = cn("w-full", controlClass, "h-auto py-2.5 leading-relaxed");

/** Checkbox: a caixa no azul profundo quando marcada, com a borda a 3:1. */
export const CHECKBOX_INPUT_CLASS =
  "h-4 w-4 shrink-0 cursor-pointer rounded border-caetano-anthracite-60 accent-caetano-deep-blue";

/** Label de uma checkbox em linha: toda a linha é a área de toque (40 px de altura). */
export const CHECKBOX_LABEL_CLASS =
  "flex min-h-10 cursor-pointer items-center gap-2.5 text-sm text-caetano-anthracite";

/**
 * Checkbox em mosaico: a opção marcada fica no azul cyan claro com a borda
 * no azul profundo, para se ver de relance o que está ligado.
 */
export const CHECKBOX_TILE_CLASS = cn(
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-caetano-medium-gray-40 bg-white px-3.5 py-2.5 text-sm text-caetano-anthracite",
  "transition-[border-color,background-color,box-shadow] duration-200 ease-(--ease-out-expo)",
  "hover:border-caetano-deep-blue-40 hover:shadow-xs",
  "has-[:checked]:border-caetano-deep-blue-60 has-[:checked]:bg-caetano-cyan-20",
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-caetano-cyan",
);

/** Botão só com ícone (subir, descer) numa linha de uma lista. */
export const ICON_BUTTON_CLASS = cn(
  "flex h-10 w-10 cursor-pointer touch-manipulation items-center justify-center rounded-lg text-caetano-anthracite-80",
  "transition-colors duration-200 hover:bg-caetano-medium-gray-20 hover:text-caetano-deep-blue active:bg-caetano-medium-gray-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
  "disabled:pointer-events-none disabled:cursor-default disabled:opacity-30",
);

/** Item de uma lista dentro de um cartão (pares, prémios, segmentos, perguntas, campos). */
export const LIST_ITEM_CLASS = cn(
  "rounded-xl border border-caetano-medium-gray-40 bg-white p-3 sm:p-4",
  "transition-[border-color,box-shadow] duration-200 ease-(--ease-out-expo)",
  // A linha que se está a editar destaca-se das outras.
  "has-[details[open]]:border-caetano-deep-blue-40 has-[details[open]]:shadow-sm",
);

/** Zona de "adicionar" no fim de uma lista: o cinza claro separa-a do que já existe. */
export const ADD_PANEL_CLASS = "rounded-xl border border-caetano-medium-gray-40 bg-caetano-medium-gray-20 p-3 sm:p-4";

/** O `<summary>` de um `<details>` com a classe `group`: um link com uma seta que roda ao abrir. */
export const SUMMARY_CLASS = cn(
  "inline-flex min-h-10 cursor-pointer list-none select-none items-center gap-1.5 rounded-lg text-sm font-medium text-caetano-deep-blue",
  "transition-colors duration-200 hover:text-caetano-deep-blue-80",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
  "[&::-webkit-details-marker]:hidden",
);

/** A seta do `SUMMARY_CLASS` (dentro do `<summary>`). */
export function SummaryChevron() {
  return (
    <ChevronDown
      size={16}
      aria-hidden="true"
      className="shrink-0 transition-transform duration-300 ease-(--ease-out-expo) group-open:rotate-180"
    />
  );
}

/** Cabeçalho de uma etapa: o `h2` da página, por baixo do nome da campanha. */
export function StepHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        {/* O mesmo título da etapa Marca e design: nada muda de tamanho ao passar de etapa. */}
        <h2 className="text-lg font-bold leading-tight tracking-tight text-caetano-deep-blue sm:text-xl">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-caetano-anthracite-80">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Título (h3) de uma secção dentro de um cartão, com uma linha de ajuda opcional. */
export function SectionHeading({
  title,
  description,
  id,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  id?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <div className="min-w-0">
        <h3 id={id} className="text-base font-bold text-caetano-deep-blue">
          {title}
        </h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-caetano-anthracite-80 sm:text-sm">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Um grupo de campos com um título curto e uma linha a separá-lo do
 * anterior — o mesmo desenho dos grupos da etapa Marca e design.
 */
export function FieldGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset
      className={cn(
        "min-w-0 border-t border-caetano-medium-gray-40 pt-5 first-of-type:border-t-0 first-of-type:pt-0",
        className,
      )}
    >
      {/* `float` tira a legenda da borda do fieldset; o `clear` do conteúdo
          põe-no por baixo dela (uma grelha ao lado de um float encolhia). */}
      <legend className="float-left mb-4 w-full text-xs font-bold uppercase tracking-[0.12em] text-caetano-deep-blue-80">
        {title}
      </legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/** Lista vazia: diz o que falta, num quadro tracejado. */
export function ListEmpty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-caetano-medium-gray-60 bg-caetano-medium-gray-20 px-4 py-8 text-center">
      {icon && (
        <span
          aria-hidden="true"
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-caetano-cyan-20 text-caetano-deep-blue"
        >
          {icon}
        </span>
      )}
      <p className="max-w-sm text-sm text-caetano-anthracite-80">{children}</p>
    </div>
  );
}
