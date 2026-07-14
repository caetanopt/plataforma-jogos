"use client";

import { useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

export function CopyButton({
  value,
  label = "Copiar",
  variant = "outline",
  size = "sm",
}: {
  value: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button type="button" variant={variant} size={size} onClick={handleCopy}>
      {copied ? "Copiado!" : label}
    </Button>
  );
}
