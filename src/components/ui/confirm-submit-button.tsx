"use client";

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { buttonVariants, type ButtonVariant, type ButtonSize } from "@/components/ui/button";

interface ConfirmSubmitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  confirmMessage: string;
  /** Cabeçalho do diálogo. Por omissão usa o texto do botão. */
  confirmTitle?: string;
  /** Texto do botão que confirma. */
  confirmLabel?: string;
  /**
   * Severidade da ação, que decide o aspeto do diálogo. É independente da
   * `variant` do gatilho: um item de menu discreto (ghost) pode disparar uma
   * confirmação destrutiva.
   */
  severity?: "danger" | "warning";
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/**
 * Botão de submissão com confirmação.
 *
 * Substitui o `window.confirm`, que bloqueava a thread do browser, ignorava a
 * identidade da marca, não distinguia severidade e era impossível de estilizar
 * ou testar de forma fiável.
 *
 * Usa o `<dialog>` nativo com `showModal()`: traz de origem o foco preso, o
 * fecho com Esc e o fundo inerte — comportamentos que uma reimplementação em
 * React quase sempre acaba por fazer pela metade.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  confirmTitle,
  confirmLabel = "Confirmar",
  severity = "danger",
  variant = "danger",
  size = "sm",
  className,
  children,
  onClick,
  ...props
}: ConfirmSubmitButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();
  // Há vários destes por página: um id fixo criava duplicados no documento.
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleTriggerClick(event: React.MouseEvent<HTMLButtonElement>) {
    // Segunda passagem, já confirmada: deixa a submissão seguir.
    if (confirmedRef.current) {
      confirmedRef.current = false;
      onClick?.(event);
      return;
    }
    event.preventDefault();
    setOpen(true);
  }

  function handleConfirm() {
    setOpen(false);
    confirmedRef.current = true;
    const trigger = triggerRef.current;
    // `requestSubmit` com o próprio botão como submitter mantém o name/value
    // do botão no FormData, tal como um clique normal.
    trigger?.form?.requestSubmit(trigger);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="submit"
        disabled={pending || props.disabled}
        aria-busy={pending || undefined}
        className={buttonVariants({ variant, size, className })}
        {...props}
        onClick={handleTriggerClick}
      >
        {pending && <Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin" />}
        {children}
      </button>

      <dialog
        ref={dialogRef}
        // O Esc do `<dialog>` fecha sem passar pelo nosso estado.
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-caetano-medium-gray-40 bg-white p-0 text-caetano-anthracite shadow-lg backdrop:bg-caetano-anthracite/50"
      >
        <div className="flex items-start gap-3 p-6">
          <span
            aria-hidden="true"
            className={
              severity === "danger"
                ? "mt-0.5 shrink-0 text-danger"
                : "mt-0.5 shrink-0 text-caetano-dynamic-orange"
            }
          >
            <AlertTriangle size={20} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold">
              {confirmTitle ?? (typeof children === "string" ? children : "Confirmar")}
            </h2>
            <p className="mt-1 text-sm text-caetano-anthracite-80">{confirmMessage}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-caetano-medium-gray-40 bg-caetano-medium-gray-20 px-6 py-3">
          {/* type="button": sem isto submeteriam o formulário que envolve o diálogo. */}
          <button type="button" onClick={() => setOpen(false)} className={buttonVariants({ variant: "outline" })}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={buttonVariants({ variant: severity === "danger" ? "danger" : "primary" })}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
