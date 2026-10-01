"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

type Outcome = { tone: "success" | "error"; text: string } | null;

const FALLBACK_NAME = "dados-titular.json";

function filenameFrom(disposition: string | null): string {
  return /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? FALLBACK_NAME;
}

function exportedMessage(header: string | null): string {
  const count = Number(header);
  if (!Number.isFinite(count)) return "Ficheiro descarregado.";
  if (count === 0) {
    return "Ficheiro descarregado: nenhuma participação com este e-mail ou telefone exatos (o ficheiro diz isso ao titular).";
  }
  return `Ficheiro descarregado: ${count === 1 ? "1 participação" : `${count} participações`}.`;
}

/**
 * Exportação dos dados de um titular (§24): lê o e-mail ou o telefone do
 * formulário do pedido, pede o ficheiro por POST (o identificador nunca vai
 * no URL) e descarrega-o. Não submete o formulário: os outros botões dele
 * procuram e anonimizam.
 */
export function SubjectExportButton({ inputName }: { inputName: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const run = async () => {
    const input = buttonRef.current?.form?.elements.namedItem(inputName);
    if (!(input instanceof HTMLInputElement) || pending) return;
    // A mesma validação do browser que os outros botões do formulário.
    if (!input.reportValidity()) return;
    setPending(true);
    setOutcome(null);
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
        setOutcome({ tone: "error", text: body?.error ?? "A exportação falhou. Tente de novo." });
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFrom(response.headers.get("content-disposition"));
      document.body.append(link);
      link.click();
      link.remove();
      // Depois de o browser começar a guardar: revogar já cancelava o download.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOutcome({ tone: "success", text: exportedMessage(response.headers.get("x-subject-participations")) });
    } catch {
      setOutcome({ tone: "error", text: "A exportação falhou. Tente de novo." });
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button ref={buttonRef} type="button" variant="outline" onClick={run} disabled={pending} aria-busy={pending || undefined}>
        {pending ? "A exportar…" : "Exportar os dados do titular"}
      </Button>
      {/* Sempre montado: o leitor de ecrã anuncia a mudança. */}
      <div aria-live="polite" className="order-last basis-full">
        {outcome?.tone === "success" && (
          <p className="inline-flex items-center gap-1.5 text-xs text-caetano-anthracite-80">
            <Check size={12} aria-hidden="true" className="text-caetano-eco-green" />
            {outcome.text}
          </p>
        )}
        {outcome?.tone === "error" && (
          <p className="inline-flex items-start gap-1.5 text-xs font-medium text-danger-strong">
            <AlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />
            {outcome.text}
          </p>
        )}
      </div>
    </>
  );
}
