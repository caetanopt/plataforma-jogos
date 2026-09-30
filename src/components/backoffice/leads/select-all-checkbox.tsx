"use client";

/**
 * Marca ou desmarca todas as caixas de seleção da página que pertencem ao
 * formulário `formId` (as de cada linha da tabela, com `form="…"`).
 */
export function SelectAllCheckbox({ formId, name, label }: { formId: string; name: string; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 rounded border-caetano-medium-gray"
      onChange={(event) => {
        const boxes = document.querySelectorAll<HTMLInputElement>(
          `input[type="checkbox"][form="${CSS.escape(formId)}"][name="${CSS.escape(name)}"]:not(:disabled)`,
        );
        for (const box of boxes) box.checked = event.currentTarget.checked;
      }}
    />
  );
}
