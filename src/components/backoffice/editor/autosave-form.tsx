"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import { IDLE, type FormAction } from "@/lib/forms/action-result";
import {
  FormActionContext,
  useFieldErrorAria,
  useFormActionState,
  type FormActionContextValue,
} from "@/components/forms/form-action-context";
import { SaveStatus } from "@/components/backoffice/editor/save-status";

const AUTOSAVE_DELAY_MS = 900;

/**
 * Formulário do editor que grava sozinho: checkboxes e selects de imediato,
 * texto depois de uma pausa, media quando o upload termina.
 *
 * O `<form>` não tem `action=`: com ele, o React repunha o formulário no fim
 * de cada gravação (reset dos inputs não controlados), e num erro o texto
 * escrito voltava ao valor antigo por baixo de "Alterações guardadas". O
 * envio corre pelo `useActionState` dentro de uma transição, que não faz
 * reset. Sem `requestSubmit` também não há validação HTML a roubar o foco
 * enquanto se escreve noutro campo: a validação é do servidor, campo a campo,
 * e os erros voltam em `SaveStatus`.
 */
export function AutoSaveForm({
  action,
  children,
  className,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { result, dispatch, isPending, uploading, setUploading, idPrefix } = useFormActionState(action);
  const busyRef = useRef(false);

  const submitNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const form = formRef.current;
    if (!form) return;
    // O FormData é lido agora: cada gravação leva o estado do formulário no
    // momento em que foi pedida, e o useActionState corre-as por ordem.
    const formData = new FormData(form);
    startTransition(() => dispatch(formData));
  }, [dispatch]);

  const scheduleSubmit = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      submitNow();
    }, AUTOSAVE_DELAY_MS);
  }, [submitNow]);

  // Sair da etapa (navegação lateral) menos de 900 ms depois de uma edição
  // não pode perder a edição. `useLayoutEffect` porque a sua limpeza corre
  // antes de o React desligar a ref do `<form>`. Chama a ação diretamente:
  // submeter o `<form>` a meio de uma navegação faz o Next falhar a resolver
  // a Server Action. Com a gravação parcial, só um campo inválido fica por
  // gravar.
  useLayoutEffect(() => {
    const form = formRef.current;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (form) void action(IDLE, new FormData(form));
      }
    };
  }, [action]);

  // Fechar o separador com uma gravação por fazer: grava já e pede ao
  // browser que confirme a saída.
  useEffect(() => {
    busyRef.current = isPending || uploading;
  }, [isPending, uploading]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (timerRef.current) submitNow();
      else if (!busyRef.current) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitNow]);

  useFieldErrorAria(formRef, result, idPrefix);

  const handleChange = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target;
    // A escolha do ficheiro não é a alteração: o id só existe quando o
    // upload termina, e é o MediaUploadField que avisa (notifyChange).
    if (target instanceof HTMLInputElement && target.type === "file") return;
    const immediate =
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"));
    if (immediate) submitNow();
    else scheduleSubmit();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitNow();
  };

  const contextValue = useMemo<FormActionContextValue>(
    () => ({ result, isPending, uploading, idPrefix, setUploading, notifyChange: submitNow }),
    [result, isPending, uploading, idPrefix, setUploading, submitNow],
  );

  return (
    <FormActionContext.Provider value={contextValue}>
      <form ref={formRef} className={className} onChange={handleChange} onSubmit={handleSubmit} noValidate>
        {children}
        <SaveStatus />
      </form>
    </FormActionContext.Provider>
  );
}
