"use client";

import { useRef, useState } from "react";
import { Label } from "@/components/ui/label";
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

  function notifyParentForm(nextValue: string) {
    if (!hiddenInputRef.current) return;
    hiddenInputRef.current.value = nextValue;
    hiddenInputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
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
        const { uploadUrl, key, publicUrl } = await presignRes.json();

        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!putRes.ok) throw new Error("Falha ao enviar o ficheiro para o armazenamento.");

        const confirmRes = await fetch("/api/uploads/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, mimeType: file.type, sizeBytes: file.size, publicUrl }),
        });
        if (!confirmRes.ok) {
          throw new Error((await confirmRes.json().catch(() => null))?.error ?? "Falha no upload.");
        }
        result = await confirmRes.json();
      }

      setMediaId(result.id);
      setPreviewUrl(result.url);
      setKind(result.kind);
      setStatus("idle");
      notifyParentForm(result.id);
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Erro desconhecido.");
    }
  }

  function handleRemove() {
    setMediaId("");
    setPreviewUrl("");
    setKind(null);
    notifyParentForm("");
  }

  return (
    <div>
      <Label>{label}</Label>
      <input ref={hiddenInputRef} type="hidden" name={name} defaultValue={mediaId} />

      {previewUrl && (
        <div className="mb-2">
          {kind === "VIDEO" ? (
            <video src={previewUrl} controls className="h-32 rounded-lg border border-caetano-medium-gray/30" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="h-32 rounded-lg border border-caetano-medium-gray/30 object-contain"
            />
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-neutral-100">
          {previewUrl ? "Substituir" : "Carregar ficheiro"}
          <input type="file" accept={accept} className="hidden" onChange={handleFileChange} />
        </label>
        {previewUrl && (
          <button
            type="button"
            onClick={handleRemove}
            className="text-sm text-red-600 hover:underline"
          >
            Remover
          </button>
        )}
        {status === "uploading" && (
          <span className="text-xs text-caetano-medium-gray">A carregar…</span>
        )}
      </div>

      {helpText && <p className="mt-1 text-xs text-caetano-medium-gray">{helpText}</p>}
      {status === "error" && <p className="mt-1 text-xs text-red-600">{errorMessage}</p>}
    </div>
  );
}
