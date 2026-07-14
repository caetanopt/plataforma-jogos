"use client";

import { useRef, type FormEvent, type ReactNode } from "react";

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
      formRef.current?.requestSubmit();
    }, AUTOSAVE_DELAY_MS);
  };

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
