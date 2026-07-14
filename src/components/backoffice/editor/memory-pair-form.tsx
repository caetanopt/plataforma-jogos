"use client";

import { useState } from "react";
import { addMemoryPairAction } from "@/features/memory-game/actions";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const KIND_LABELS = {
  SAME_IMAGE: "Pares de imagens iguais",
  DIFFERENT_IMAGE_MATCH: "Imagens diferentes associadas",
  IMAGE_TEXT: "Imagem + texto",
  TEXT_TEXT: "Texto + texto",
} as const;

type Kind = keyof typeof KIND_LABELS;

export function MemoryPairForm({ campaignId }: { campaignId: string }) {
  const [kind, setKind] = useState<Kind>("SAME_IMAGE");

  return (
    <form action={addMemoryPairAction} className="space-y-3 rounded-lg border border-caetano-medium-gray/20 p-3">
      <input type="hidden" name="campaignId" value={campaignId} />
      <div>
        <Label htmlFor="kind">Tipo de par</Label>
        <select
          id="kind"
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
          className="h-10 w-full max-w-xs rounded-lg border border-caetano-medium-gray px-3 text-sm"
        >
          {(Object.entries(KIND_LABELS) as [Kind, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {kind === "SAME_IMAGE" && (
        <MediaUploadField name="cardAMediaId" label="Imagem (usada nas duas cartas do par)" />
      )}

      {kind === "DIFFERENT_IMAGE_MATCH" && (
        <div className="grid grid-cols-2 gap-3">
          <MediaUploadField name="cardAMediaId" label="Imagem A" />
          <MediaUploadField name="cardBMediaId" label="Imagem B" />
        </div>
      )}

      {kind === "IMAGE_TEXT" && (
        <div className="grid grid-cols-2 gap-3">
          <MediaUploadField name="cardAMediaId" label="Imagem" />
          <div>
            <Label htmlFor="cardBText">Texto correspondente</Label>
            <Input id="cardBText" name="cardBText" required />
          </div>
        </div>
      )}

      {kind === "TEXT_TEXT" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cardAText">Texto A</Label>
            <Input id="cardAText" name="cardAText" required />
          </div>
          <div>
            <Label htmlFor="cardBText">Texto B</Label>
            <Input id="cardBText" name="cardBText" required />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cardAAltText">Texto alternativo A</Label>
          <Input id="cardAAltText" name="cardAAltText" />
        </div>
        <div>
          <Label htmlFor="cardBAltText">Texto alternativo B</Label>
          <Input id="cardBAltText" name="cardBAltText" />
        </div>
      </div>

      <Button type="submit" variant="outline" size="sm">
        Adicionar par
      </Button>
    </form>
  );
}
