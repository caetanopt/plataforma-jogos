"use client";

import { useEffect, useRef, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";

/**
 * Inputs não controlados que acompanham o valor gravado quando ele muda no
 * servidor (por exemplo, ao aplicar um brand kit), sem serem remontados.
 *
 * Antes cada bloco levava `key={updatedAt}`: qualquer gravação remontava os
 * campos, o que tirava o foco a quem estava a escrever e matava um upload
 * que estivesse a decorrer noutro campo. O `defaultValue` sozinho não chega
 * — num input já editado, ou num `<select>`, o React não o volta a aplicar.
 *
 * Um campo com o foco nunca é mexido: é o utilizador que está a escrever.
 */
function useSyncFromServer<T extends HTMLInputElement | HTMLSelectElement>(
  value: string | number | readonly string[] | undefined,
  checked: boolean | undefined,
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || element === document.activeElement) return;
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      if (checked !== undefined) element.checked = checked;
    } else if (value !== undefined) {
      element.value = String(value);
    }
  }, [value, checked]);
  return ref;
}

export function SyncedInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const ref = useSyncFromServer<HTMLInputElement>(props.defaultValue, props.defaultChecked);
  return <input ref={ref} {...props} />;
}

export function SyncedSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const ref = useSyncFromServer<HTMLSelectElement>(props.defaultValue, undefined);
  return <select ref={ref} {...props} />;
}
