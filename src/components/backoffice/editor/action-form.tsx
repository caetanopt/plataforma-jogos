"use client";

import { Fragment, startTransition, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FormAction } from "@/lib/forms/action-result";
import {
  FormActionContext,
  useFieldErrorAria,
  useFormActionState,
  type FormActionContextValue,
} from "@/components/forms/form-action-context";
import { FormMessage } from "@/components/backoffice/editor/save-status";

const noop = () => {};

/**
 * Formulário simples do editor (adicionar, editar ou remover numa lista).
 *
 * Mostra a resposta da ação no próprio formulário. Com `<form action=>` o
 * React limpava os campos no fim de qualquer envio — um erro de validação
 * apagava o que se tinha escrito e parecia um sucesso. Aqui só se limpa
 * quando a ação confirma (reset por `key`), e nunca durante um upload.
 *
 * A validação HTML (`required`, `min`, `maxLength`) mantém-se: o evento
 * `submit` só chega depois de o browser a aceitar.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  messageClassName,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  /** Limpar os campos depois de uma resposta de sucesso (formulários de criar). */
  resetOnSuccess?: boolean;
  messageClassName?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { result, dispatch, isPending, uploading, setUploading, idPrefix } = useFormActionState(action);
  const [resetKey, setResetKey] = useState(0);
  const [seenAt, setSeenAt] = useState(0);

  if (result.status === "success" && result.at !== seenAt) {
    setSeenAt(result.at);
    if (resetOnSuccess) setResetKey((key) => key + 1);
  }

  useFieldErrorAria(formRef, result, idPrefix);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Um envio durante o upload levava o id antigo (ou nenhum).
    if (uploading || isPending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  };

  const contextValue = useMemo<FormActionContextValue>(
    () => ({ result, isPending, uploading, idPrefix, setUploading, notifyChange: noop }),
    [result, isPending, uploading, idPrefix, setUploading],
  );

  return (
    <FormActionContext.Provider value={contextValue}>
      <form ref={formRef} className={className} onSubmit={handleSubmit}>
        <Fragment key={resetKey}>{children}</Fragment>
        <FormMessage className={messageClassName} />
      </form>
    </FormActionContext.Provider>
  );
}
