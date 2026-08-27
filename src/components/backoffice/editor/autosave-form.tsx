"use client";

import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from "react";

const AUTOSAVE_DELAY_MS = 900;

export function AutoSaveForm({
  action,
  children,
  className,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSubmit = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      formRef.current?.requestSubmit();
    }, AUTOSAVE_DELAY_MS);
  };

  // Sem isto, sair da etapa (navegação lateral) menos de 900ms depois de uma
  // edição de texto cancelava silenciosamente o autosave pendente: o
  // temporizador nunca era limpo, e quando disparava mais tarde o formulário
  // já estava desmontado (`formRef.current` a null), pelo que a última
  // alteração nunca chegava a ser guardada. Usa `useLayoutEffect` (não
  // `useEffect`) porque a sua limpeza corre antes de o React desligar a ref
  // do `<form>` — se corresse depois, `formRef.current` já seria null aqui
  // também.
  //
  // Chama `action` diretamente com o FormData atual em vez de
  // `formRef.current.requestSubmit()`: a desmontagem acontece a meio de uma
  // navegação client-side para outra rota, e submeter o `<form>` nesse
  // instante faz o Next.js falhar a resolver a Server Action ("Failed to
  // find Server Action") porque a submissão fica associada à navegação em
  // curso. Chamar a função da action diretamente não depende do routing.
  useLayoutEffect(() => {
    const form = formRef.current;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (form) {
          void action(new FormData(form));
        }
      }
    };
  }, [action]);

  const handleChange = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    // Checkboxes/selects guardam de imediato; texto livre aguarda uma pausa.
    if (target instanceof HTMLSelectElement || (target as HTMLInputElement).type === "checkbox") {
      formRef.current?.requestSubmit();
      return;
    }
    scheduleSubmit();
  };

  return (
    <form ref={formRef} action={action} className={className} onChange={handleChange}>
      {children}
    </form>
  );
}
