"use client";

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type RefObject,
} from "react";
import { IDLE, type ActionResult, type FormAction } from "@/lib/forms/action-result";

export interface FormActionContextValue {
  result: ActionResult;
  isPending: boolean;
  /** Há um upload de media a decorrer dentro do formulário. */
  uploading: boolean;
  /** Prefixo dos ids das mensagens: há vários formulários por página. */
  idPrefix: string;
  setUploading: (uploadId: string, active: boolean) => void;
  /**
   * Um campo mudou sem evento de input (fim de upload, "Remover"): no
   * autosave grava já; num formulário normal não faz nada, o valor segue no
   * próximo envio.
   */
  notifyChange: () => void;
  /**
   * Uma tarefa do formulário que não é a ação está a decorrer (a exportação
   * dos dados de um titular): os envios esperam que acabe. Só no ActionForm.
   */
  busy?: boolean;
  setBusy?: (taskId: string, active: boolean) => void;
  /**
   * Esconde a resposta que está à vista até à próxima: outra tarefa do
   * formulário tornou-a antiga. A mensagem, o `aria-invalid` dos campos e a
   * confirmação tratam-na como se não houvesse resposta. Só no ActionForm.
   */
  dismissResult?: () => void;
}

export const FormActionContext = createContext<FormActionContextValue | null>(null);

/** `null` fora de um AutoSaveForm/ActionForm. */
export function useFormAction(): FormActionContextValue | null {
  return useContext(FormActionContext);
}

export function fieldErrorId(idPrefix: string, name: string): string {
  return `${idPrefix}-${name}-error`;
}

/** Tarefas a decorrer, por id: várias ao mesmo tempo, cada uma retira-se a si. */
function useActiveTasks(): [boolean, (taskId: string, active: boolean) => void] {
  const [tasks, setTasks] = useState<ReadonlySet<string>>(() => new Set());

  const setActive = useCallback((taskId: string, active: boolean) => {
    setTasks((previous) => {
      if (previous.has(taskId) === active) return previous;
      const next = new Set(previous);
      if (active) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  return [tasks.size > 0, setActive];
}

/** Estado partilhado pelo AutoSaveForm e pelo ActionForm. */
export function useFormActionState(action: FormAction) {
  const [latest, dispatch, isPending] = useActionState(action, IDLE);
  const [uploading, setUploading] = useActiveTasks();
  const [busy, setBusy] = useActiveTasks();
  // Pela identidade do objeto: a resposta seguinte é sempre um objeto novo
  // (mesmo com a mesma mensagem) e volta a aparecer.
  const [dismissed, setDismissed] = useState<ActionResult | null>(null);
  const idPrefix = useId();

  const result = latest === dismissed ? IDLE : latest;
  const dismissResult = useCallback(() => setDismissed(latest), [latest]);

  return { result, dispatch, isPending, uploading, setUploading, busy, setBusy, dismissResult, idPrefix };
}

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isField(element: Element): element is FieldElement {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

/**
 * Liga cada campo com erro à sua mensagem (§27): `aria-invalid` e
 * `aria-describedby` a apontar para a linha do estado da gravação. Feito
 * aqui, e não em cada input, para servir todos os formulários sem os
 * reescrever. Só retira o que ele próprio pôs.
 */
export function useFieldErrorAria(
  formRef: RefObject<HTMLFormElement | null>,
  result: ActionResult,
  idPrefix: string,
): void {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const errors = result.status === "error" ? result.fieldErrors : {};
    const ownPrefix = `${idPrefix}-`;

    for (const element of Array.from(form.elements)) {
      if (!isField(element) || !element.name) continue;
      if (element instanceof HTMLInputElement && element.type === "hidden") continue;

      const tokens = (element.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter((token) => token && !token.startsWith(ownPrefix));

      if (element.name in errors) {
        element.setAttribute("aria-invalid", "true");
        element.dataset.actionInvalid = "true";
        tokens.push(fieldErrorId(idPrefix, element.name));
      } else if (element.dataset.actionInvalid) {
        element.removeAttribute("aria-invalid");
        delete element.dataset.actionInvalid;
      }

      if (tokens.length > 0) element.setAttribute("aria-describedby", tokens.join(" "));
      else element.removeAttribute("aria-describedby");
    }
  }, [formRef, result, idPrefix]);
}
