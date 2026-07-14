"use client";

import { useFormStatus } from "react-dom";

export function SaveStatus() {
  const { pending } = useFormStatus();

  return (
    <span aria-live="polite" className="text-xs text-caetano-medium-gray">
      {pending ? "A guardar…" : ""}
    </span>
  );
}
