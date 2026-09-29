"use client";

import { useState } from "react";
import { SyncedInput } from "@/components/forms/synced-fields";
import { Label } from "@/components/ui/label";

/**
 * Cor do tema com o código ao lado. O código segue o input enquanto se
 * escolhe a cor e quando o valor gravado muda no servidor (brand kit
 * aplicado). Antes era texto fixo da página e o input remontava a cada
 * gravação para acompanhar o kit.
 */
export function ThemeColorField({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  // Mesmo padrão do MediaUploadField: um valor novo do servidor substitui o
  // que se mostra.
  const [syncedDefault, setSyncedDefault] = useState(defaultValue);
  if (defaultValue !== syncedDefault) {
    setSyncedDefault(defaultValue);
    setValue(defaultValue);
  }

  const codeId = `${id}-code`;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <SyncedInput
          type="color"
          id={id}
          name={name}
          defaultValue={defaultValue}
          onChange={(event) => setValue(event.currentTarget.value)}
          aria-describedby={codeId}
          className="h-10 w-14 cursor-pointer rounded-lg border border-caetano-medium-gray"
        />
        <span id={codeId} className="font-mono text-sm uppercase text-caetano-anthracite-80">
          {value}
        </span>
      </div>
    </div>
  );
}
