"use client";

import { useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SyncedSelect } from "@/components/forms/synced-fields";
import { HELP_CLASS, SELECT_CLASS, SelectShell } from "@/components/backoffice/editor/editor-ui";

const CUSTOM_MAX = "CUSTOM_MAX";

/** "1 000 000" sem `toLocaleString`, que pode diferir entre o servidor e o browser (hidratação). */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Limite de participação e máximo personalizado da etapa Regras.
 *
 * O máximo ativa-se pelo valor escolhido agora no select, não pelo gravado:
 * antes, escolher "Máximo personalizado" gravava o tipo com o campo ainda
 * desativado (fora do envio), e a campanha ficava limitada a uma
 * participação sem ninguém dar por isso.
 */
export function ParticipationLimitFields({
  options,
  defaultType,
  defaultCustomMax,
  customMaxMin,
  customMaxMax,
}: {
  options: ReadonlyArray<{ value: string; label: string }>;
  defaultType: string;
  defaultCustomMax: number | null;
  customMaxMin: number;
  customMaxMax: number;
}) {
  const [type, setType] = useState(defaultType);

  // Quando o tipo gravado muda (outra gravação, outro separador), o estado
  // acompanha-o, como o SyncedSelect faz ao valor do select. Uma recusa do
  // servidor não o muda: a escolha fica à vista, com o erro.
  const [followedDefault, setFollowedDefault] = useState(defaultType);
  if (defaultType !== followedDefault) {
    setFollowedDefault(defaultType);
    setType(defaultType);
  }

  const handleTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    // Síncrono: a gravação automática lê o formulário a seguir, no mesmo
    // evento, e o máximo tem de já ir (ou não) conforme a nova escolha.
    flushSync(() => setType(next));
  };

  const customMaxEnabled = type === CUSTOM_MAX;

  // Um por baixo do outro: a ajuda do máximo fala do "limite acima".
  return (
    <>
      <div>
        <Label htmlFor="participationLimitType">Limite de participação</Label>
        <SelectShell>
          <SyncedSelect
            id="participationLimitType"
            name="participationLimitType"
            defaultValue={defaultType}
            onChange={handleTypeChange}
            className={SELECT_CLASS}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SyncedSelect>
        </SelectShell>
      </div>

      <div>
        <Label htmlFor="participationCustomMax">Máximo personalizado</Label>
        <Input
          id="participationCustomMax"
          name="participationCustomMax"
          type="number"
          inputMode="numeric"
          min={customMaxMin}
          max={customMaxMax}
          step={1}
          defaultValue={defaultCustomMax ?? ""}
          disabled={!customMaxEnabled}
          aria-required={customMaxEnabled}
          aria-describedby="participationCustomMax-help"
          className="disabled:bg-caetano-medium-gray-20 sm:max-w-xs"
        />
        <p id="participationCustomMax-help" className={HELP_CLASS}>
          {customMaxEnabled
            ? `Obrigatório: número de participações por pessoa (${customMaxMin} a ${groupThousands(customMaxMax)}).`
            : "Só aplicável quando o limite acima é «Máximo personalizado»."}
        </p>
      </div>
    </>
  );
}
