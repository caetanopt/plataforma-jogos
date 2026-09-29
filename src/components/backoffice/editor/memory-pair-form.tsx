"use client";

import { useState } from "react";
import type { FormAction } from "@/lib/forms/action-result";
import { MEMORY_PAIR_LIMITS, type MemoryPairKind } from "@/lib/validation/memory-game";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

const KIND_LABELS: Record<MemoryPairKind, string> = {
  SAME_IMAGE: "Pares de imagens iguais",
  DIFFERENT_IMAGE_MATCH: "Imagens diferentes associadas",
  IMAGE_TEXT: "Imagem + texto",
  TEXT_TEXT: "Texto + texto",
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/svg+xml";

function isKind(value: string): value is MemoryPairKind {
  return Object.hasOwn(KIND_LABELS, value);
}

/**
 * Formulário de um par novo.
 *
 * Só limpa os campos quando o servidor confirma: antes o React limpava-os
 * em qualquer resposta, e um par recusado desaparecia do formulário sem
 * aviso — enquanto a imagem carregada ficava e ia, sem se ver, no par
 * seguinte. O tipo de par fica escolhido (está fora do reset) para se
 * adicionarem vários do mesmo tipo seguidos.
 */
export function MemoryPairForm({ action, campaignId }: { action: FormAction; campaignId: string }) {
  const [kind, setKind] = useState<MemoryPairKind>("SAME_IMAGE");

  return (
    <ActionForm action={action} className="space-y-3 rounded-lg border border-caetano-medium-gray-20 p-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div>
        <Label htmlFor="kind">Tipo de par</Label>
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(event) => {
            if (isKind(event.target.value)) setKind(event.target.value);
          }}
          className="h-10 w-full max-w-xs rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm text-caetano-anthracite focus-visible:border-caetano-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan"
        >
          {(Object.entries(KIND_LABELS) as [MemoryPairKind, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {kind === "SAME_IMAGE" && (
        <MediaUploadField name="cardAMediaId" label="Imagem (usada nas duas cartas do par)" accept={IMAGE_ACCEPT} />
      )}

      {kind === "DIFFERENT_IMAGE_MATCH" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <MediaUploadField name="cardAMediaId" label="Imagem da carta A" accept={IMAGE_ACCEPT} />
          <MediaUploadField name="cardBMediaId" label="Imagem da carta B" accept={IMAGE_ACCEPT} />
        </div>
      )}

      {kind === "IMAGE_TEXT" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <MediaUploadField name="cardAMediaId" label="Imagem da carta A" accept={IMAGE_ACCEPT} />
          <div>
            <Label htmlFor="cardBText">Texto da carta B</Label>
            <Input id="cardBText" name="cardBText" maxLength={MEMORY_PAIR_LIMITS.text} required />
          </div>
        </div>
      )}

      {kind === "TEXT_TEXT" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cardAText">Texto da carta A</Label>
            <Input id="cardAText" name="cardAText" maxLength={MEMORY_PAIR_LIMITS.text} required />
          </div>
          <div>
            <Label htmlFor="cardBText">Texto da carta B</Label>
            <Input id="cardBText" name="cardBText" maxLength={MEMORY_PAIR_LIMITS.text} required />
          </div>
        </div>
      )}

      {/* O texto alternativo descreve uma imagem: as cartas de texto não o têm. */}
      {kind !== "TEXT_TEXT" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="cardAAltText">Texto alternativo da carta A</Label>
            <Input id="cardAAltText" name="cardAAltText" maxLength={MEMORY_PAIR_LIMITS.altText} />
          </div>
          {kind !== "IMAGE_TEXT" && (
            <div>
              <Label htmlFor="cardBAltText">Texto alternativo da carta B</Label>
              <Input id="cardBAltText" name="cardBAltText" maxLength={MEMORY_PAIR_LIMITS.altText} />
            </div>
          )}
        </div>
      )}

      <SubmitButton variant="outline" size="sm">
        Adicionar par
      </SubmitButton>
    </ActionForm>
  );
}
