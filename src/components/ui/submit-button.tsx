"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

interface SubmitButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Texto alternativo enquanto a ação decorre. Por omissão mantém o normal. */
  pendingLabel?: string;
  children: ReactNode;
}

/**
 * Botão de submissão que se desativa e mostra progresso enquanto a server
 * action corre.
 *
 * `useFormStatus` só reporta o estado do formulário mais próximo acima na
 * árvore, e apenas a partir de um componente filho desse formulário — por isso
 * este componente tem de ser usado dentro do `<form>`, nunca a envolvê-lo.
 *
 * Resolve dois problemas reais: o utilizador deixa de poder submeter duas
 * vezes (duplicando campanhas, pastas ou leads) e deixa de ficar sem resposta
 * durante ações lentas.
 */
export function SubmitButton({
  variant = "primary",
  size = "md",
  className,
  pendingLabel,
  children,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {pending && <Loader2 size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
