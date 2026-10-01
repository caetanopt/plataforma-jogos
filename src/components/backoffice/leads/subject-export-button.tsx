"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/components/forms/form-action-context";
import { countSubjectExport, describeSubjectExport } from "@/features/privacy/subject-export-summary";

type Outcome =
  | { tone: "success"; text: string }
  /** `invalid`: o servidor recusou o identificador, o erro é do campo. */
  | { tone: "error"; text: string; invalid: boolean }
  | null;

const FALLBACK_NAME = "dados-titular.json";
const FAILED = "A exportação falhou. Tente de novo.";
const INCOMPLETE = "A exportação falhou: o ficheiro chegou incompleto e não foi descarregado. Tente de novo.";

function filenameFrom(disposition: string | null): string {
  return /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? FALLBACK_NAME;
}

function inputOf(button: HTMLButtonElement | null, name: string): HTMLInputElement | null {
  const element = button?.form?.elements.namedItem(name);
  return element instanceof HTMLInputElement ? element : null;
}

function describedBy(element: HTMLElement, without: string): string[] {
  return (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((token) => token && token !== without);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Depois de o browser começar a guardar: revogar já cancelava o download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Exportação dos dados de um titular (§24): lê o e-mail ou o telefone do
 * formulário do pedido, pede o ficheiro por POST (o identificador nunca vai
 * no URL) e descarrega-o. Não submete o formulário: os outros botões dele
 * procuram e anonimizam.
 *
 * Partilha o sítio com a resposta desses botões, por isso as duas não se
 * cruzam: enquanto o formulário envia, não exporta; enquanto exporta, o
 * formulário não envia (`setBusy`) e o campo fica só de leitura; ao começar,
 * esconde a resposta anterior do formulário (`dismissResult`); e mudar o
 * campo ou enviar o formulário apaga a mensagem da exportação.
 *
 * Fica com `aria-disabled`, não `disabled`, enquanto espera: o foco não sai
 * do botão, e o estado é anunciado na região que está sempre montada.
 */
export function SubjectExportButton({ inputName }: { inputName: string }) {
  const form = useFormAction();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // O estado só muda no render seguinte: dois Enter seguidos exportavam duas vezes.
  const runningRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const taskId = useId();
  const errorId = `${taskId}-error`;
  const setBusy = form?.setBusy;
  // O formulário está a procurar ou a anonimizar (ou num upload).
  const formBusy = Boolean(form?.isPending || form?.uploading);
  const invalid = outcome?.tone === "error" && outcome.invalid;

  // Outro identificador ou outro pedido: a mensagem da exportação já não é dele.
  useEffect(() => {
    const element = buttonRef.current?.form;
    if (!element) return;
    const clear = (event: Event) => {
      const target = event.target;
      if (event.type === "submit" || (target instanceof HTMLInputElement && target.name === inputName)) {
        setOutcome(null);
      }
    };
    element.addEventListener("input", clear);
    element.addEventListener("submit", clear);
    return () => {
      element.removeEventListener("input", clear);
      element.removeEventListener("submit", clear);
    };
  }, [inputName]);

  // Identificador recusado: o campo fica inválido e aponta para o erro (§27),
  // como os erros do formulário. Sai quando a mensagem sai.
  useEffect(() => {
    const input = inputOf(buttonRef.current, inputName);
    if (!input || !invalid) return;
    input.setAttribute("aria-invalid", "true");
    input.dataset.exportInvalid = "true";
    input.setAttribute("aria-describedby", [...describedBy(input, errorId), errorId].join(" "));
    return () => {
      delete input.dataset.exportInvalid;
      // Um erro do próprio formulário (useFieldErrorAria) fica.
      if (!input.dataset.actionInvalid) input.removeAttribute("aria-invalid");
      const tokens = describedBy(input, errorId);
      if (tokens.length > 0) input.setAttribute("aria-describedby", tokens.join(" "));
      else input.removeAttribute("aria-describedby");
    };
  }, [invalid, inputName, errorId]);

  // Desmontado a meio da exportação: o formulário não fica preso.
  useEffect(() => () => setBusy?.(taskId, false), [setBusy, taskId]);

  const run = async () => {
    const input = inputOf(buttonRef.current, inputName);
    if (!input || runningRef.current || formBusy) return;
    // A mesma validação do browser que os outros botões do formulário.
    if (!input.reportValidity()) return;
    runningRef.current = true;
    const wasReadOnly = input.readOnly;
    setPending(true);
    setOutcome(null);
    setBusy?.(taskId, true);
    // A resposta de «Procurar» ou «Anonimizar» à vista era de outro pedido.
    form?.dismissResult?.();
    // O valor enviado é o que fica escrito no campo enquanto se espera.
    input.readOnly = true;
    try {
      const response = await fetch("/api/privacy/subject-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: input.value }),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setOutcome({ tone: "error", text: body?.error ?? FAILED, invalid: response.status === 400 });
        return;
      }
      const blob = await response.blob();
      // As contagens do que o ficheiro leva (e não dos cabeçalhos, contados
      // antes de o escrever). Um ficheiro que não se lê não vai ao titular.
      const counts = countSubjectExport(await blob.text());
      if (!counts) {
        setOutcome({ tone: "error", text: INCOMPLETE, invalid: false });
        return;
      }
      download(blob, filenameFrom(response.headers.get("content-disposition")));
      setOutcome({ tone: "success", text: describeSubjectExport(counts) });
    } catch {
      setOutcome({ tone: "error", text: FAILED, invalid: false });
    } finally {
      input.readOnly = wasReadOnly;
      setBusy?.(taskId, false);
      runningRef.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        onClick={run}
        aria-disabled={pending || formBusy || undefined}
        aria-busy={pending || undefined}
      >
        {pending && <Loader2 size={16} aria-hidden="true" className="motion-safe:animate-spin" />}
        Exportar os dados do titular
      </Button>
      {/* Sempre montado: o leitor de ecrã anuncia cada mudança. */}
      <div aria-live="polite" className="order-last basis-full">
        {pending ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80">
            <Loader2 size={12} aria-hidden="true" className="motion-safe:animate-spin" />
            A exportar os dados do titular…
          </p>
        ) : outcome?.tone === "success" ? (
          <p className="inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80">
            <Check size={12} aria-hidden="true" className="text-caetano-eco-green" />
            {outcome.text}
          </p>
        ) : outcome?.tone === "error" ? (
          <p id={errorId} className="inline-flex items-start gap-1.5 text-xs font-medium text-danger-strong">
            <AlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />
            {outcome.text}
          </p>
        ) : null}
      </div>
    </>
  );
}
