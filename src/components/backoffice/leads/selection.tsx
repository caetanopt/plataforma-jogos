"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

interface SelectionState {
  selected: number;
  selectable: number;
}

/**
 * As caixas de seleção da página que pertencem ao formulário `formId` (as de
 * cada linha da tabela, com `form="…"`), contadas a partir do DOM: seguem as
 * marcações, a mudança de página e as linhas que voltam anonimizadas.
 */
function useSelection(formId: string, name: string): SelectionState {
  const [state, setState] = useState<SelectionState>({ selected: 0, selectable: 0 });
  useEffect(() => {
    const selector = `input[type="checkbox"][form="${CSS.escape(formId)}"][name="${CSS.escape(name)}"]`;
    const recount = () => {
      const boxes = [...document.querySelectorAll<HTMLInputElement>(selector)].filter((box) => !box.disabled);
      const selected = boxes.filter((box) => box.checked).length;
      setState((previous) =>
        previous.selected === selected && previous.selectable === boxes.length
          ? previous
          : { selected, selectable: boxes.length },
      );
    };
    recount();
    document.addEventListener("change", recount);
    const observer = new MutationObserver(recount);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    return () => {
      document.removeEventListener("change", recount);
      observer.disconnect();
    };
  }, [formId, name]);
  return state;
}

function boxesOf(formId: string, name: string) {
  return document.querySelectorAll<HTMLInputElement>(
    `input[type="checkbox"][form="${CSS.escape(formId)}"][name="${CSS.escape(name)}"]:not(:disabled)`,
  );
}

/** Marca ou desmarca todas as da página; parcial quando só algumas estão marcadas. */
export function SelectAllCheckbox({ formId, name, label }: { formId: string; name: string; label: string }) {
  const { selected, selectable } = useSelection(formId, name);
  const ref = useRef<HTMLInputElement>(null);
  const all = selectable > 0 && selected === selectable;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = selected > 0 && !all;
  }, [selected, all]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={all}
      disabled={selectable === 0}
      className="h-4 w-4 rounded border-caetano-medium-gray"
      onChange={(event) => {
        const checked = event.currentTarget.checked;
        for (const box of boxesOf(formId, name)) box.checked = checked;
        // O onChange de cada caixa não dispara quando se muda por código.
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

/**
 * O botão de anonimizar a seleção: sem nada marcado não abre o diálogo, e o
 * diálogo diz quantas vão sair.
 */
export function AnonymizeSelectionButton({ formId, name, message }: { formId: string; name: string; message: string }) {
  const { selected } = useSelection(formId, name);
  return (
    <ConfirmSubmitButton
      disabled={selected === 0}
      confirmTitle={selected === 1 ? "Anonimizar 1 lead?" : `Anonimizar ${selected} leads?`}
      confirmMessage={message}
      confirmLabel="Anonimizar"
      variant="outline"
    >
      {selected > 0 ? `Anonimizar selecionadas (${selected})` : "Anonimizar selecionadas"}
    </ConfirmSubmitButton>
  );
}
