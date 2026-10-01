"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonVariants, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { useFormAction } from "@/components/forms/form-action-context";

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
 *
 * Dentro de um `ActionForm` o envio não passa pelo `action=` do `<form>`, e o
 * `useFormStatus` não o vê: o estado vem do contexto do formulário, que
 * também trava o botão durante um upload ou outra tarefa do formulário (a
 * exportação de um titular).
 *
 * Enquanto espera fica com `aria-disabled`, não `disabled`: um botão
 * desativado perde o foco, que caía no `<body>` a meio do envio, e quem usa o
 * teclado recomeçava no topo da página (WCAG 2.4.3). O clique (rato, teclado
 * ou o Enter num campo, que clica no botão por omissão) é cancelado, por isso
 * continua a não haver dois envios. `disabled` fica para quando o chamador o
 * pede.
 */
export function SubmitButton({
  variant = "primary",
  size = "md",
  className,
  pendingLabel,
  children,
  disabled,
  onClick,
  ...props
}: SubmitButtonProps) {
  const status = useFormStatus();
  const form = useFormAction();
  const pending = status.pending || Boolean(form?.isPending);
  const blocked = pending || Boolean(form?.uploading) || Boolean(form?.busy);

  return (
    <button
      type="submit"
      disabled={disabled}
      aria-disabled={blocked || undefined}
      aria-busy={pending || undefined}
      className={buttonVariants({ variant, size, className })}
      {...props}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {pending && <Loader2 size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
