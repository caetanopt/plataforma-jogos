"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { useFormAction } from "@/components/forms/form-action-context";
import type { MediaKind } from "@/generated/prisma/client";

interface MediaUploadFieldProps {
  name: string;
  label: string;
  defaultMediaId?: string | null;
  defaultUrl?: string | null;
  defaultKind?: MediaKind | null;
  accept?: string;
  helpText?: string;
}

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml,video/mp4";

export function MediaUploadField({
  name,
  label,
  defaultMediaId,
  defaultUrl,
  defaultKind,
  accept = DEFAULT_ACCEPT,
  helpText,
}: MediaUploadFieldProps) {
  const [mediaId, setMediaId] = useState(defaultMediaId ?? "");
  const [previewUrl, setPreviewUrl] = useState(defaultUrl ?? "");
  const [kind, setKind] = useState<MediaKind | null>(defaultKind ?? null);
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const hiddenInputRef = useRef<HTMLInputElement>(null);
  const form = useFormAction();
  const uploadId = useId();
  const setUploading = form?.setUploading;

  // O valor gravado mudou no servidor (brand kit aplicado, outra gravação):
  // acompanha-o, a não ser que haja um upload deste campo a meio. Antes o
  // campo era remontado por `key` a cada gravação, e um upload em curso
  // perdia-se.
  const [syncedDefault, setSyncedDefault] = useState(defaultMediaId ?? "");
  if ((defaultMediaId ?? "") !== syncedDefault && status !== "uploading") {
    setSyncedDefault(defaultMediaId ?? "");
    setMediaId(defaultMediaId ?? "");
    setPreviewUrl(defaultUrl ?? "");
    setKind(defaultKind ?? null);
  }

  useEffect(() => {
    if (!setUploading) return;
    setUploading(uploadId, status === "uploading");
    return () => setUploading(uploadId, false);
  }, [setUploading, uploadId, status]);

  /**
   * Muda o valor do campo e avisa o formulário. Um `input` sintético num
   * `<input type="hidden">` não gera onChange no React: a gravação
   * automática só disparava 900 ms depois de escolher o ficheiro, com o id
   * antigo, e o "Remover" nunca gravava.
   */
  function commit(nextValue: string) {
    // O valor vai para o DOM antes de avisar: a gravação lê o FormData já.
    if (hiddenInputRef.current) hiddenInputRef.current.value = nextValue;
    setMediaId(nextValue);
    form?.notifyChange();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStatus("uploading");
    setErrorMessage("");

    try {
      let result: { id: string; url: string; kind: MediaKind };

      if (file.type === "image/svg+xml") {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/uploads/svg", { method: "POST", body: formData });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Falha no upload.");
        result = await res.json();
      } else {
        const presignRes = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
        });
        if (!presignRes.ok) {
          throw new Error((await presignRes.json().catch(() => null))?.error ?? "Falha no upload.");
        }
        const { uploadUrl, key } = await presignRes.json();

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error("Falha ao enviar o ficheiro para o armazenamento.");

        const confirmRes = await fetch("/api/uploads/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, mimeType: file.type, sizeBytes: file.size }),
        });
        if (!confirmRes.ok) {
          throw new Error((await confirmRes.json().catch(() => null))?.error ?? "Falha no upload.");
        }
        result = await confirmRes.json();
      }

      setPreviewUrl(result.url);
      setKind(result.kind);
      setStatus("idle");
      commit(result.id);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Erro desconhecido.");
    }
  }

  function handleRemove() {
    setPreviewUrl("");
    setKind(null);
    commit("");
  }

  return (
    <div>
      <Label id={`${uploadId}-label`}>{label}</Label>
      <input ref={hiddenInputRef} type="hidden" name={name} value={mediaId} />

      {previewUrl && (
        <div className="mb-2">
          {kind === "VIDEO" ? (
            <video src={previewUrl} controls className="h-32 rounded-lg border border-caetano-medium-gray-40" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={`Pré-visualização de ${label}`}
              className="h-32 rounded-lg border border-caetano-medium-gray-40 object-contain"
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* O input fica visualmente escondido mas focável (com `hidden` não se
            chegava lá pelo teclado), e o nome inclui o do campo. */}
        <label className="cursor-pointer rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-caetano-medium-gray-20 focus-within:ring-2 focus-within:ring-caetano-cyan">
          <span id={`${uploadId}-action`}>{previewUrl ? "Substituir" : "Carregar ficheiro"}</span>
          <input
            type="file"
            accept={accept}
            className="sr-only"
            aria-labelledby={`${uploadId}-label ${uploadId}-action`}
            aria-describedby={helpText ? `${uploadId}-help` : undefined}
            onChange={handleFileChange}
          />
        </label>
        {previewUrl && (
          <button
            type="button"
            onClick={handleRemove}
            aria-label={`Remover ${label}`}
            className="text-sm text-danger hover:underline"
          >
            Remover
          </button>
        )}
        <span aria-live="polite" className="text-xs text-caetano-anthracite-80">
          {status === "uploading" ? "A carregar…" : ""}
        </span>
      </div>

      {helpText && (
        <p id={`${uploadId}-help`} className="mt-1 text-xs text-caetano-anthracite-80">
          {helpText}
        </p>
      )}
      {status === "error" && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
