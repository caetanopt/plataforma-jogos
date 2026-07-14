"use client";

import { useState } from "react";
import { addWheelSegmentAction } from "@/features/wheel-game/actions";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Prize {
  id: string;
  publicName: string;
}

export function WheelSegmentForm({ campaignId, prizes }: { campaignId: string; prizes: Prize[] }) {
  const [outcome, setOutcome] = useState<"WIN" | "NO_WIN">("WIN");

  return (
    <form action={addWheelSegmentAction} className="space-y-3 rounded-lg border border-caetano-medium-gray/20 p-3">
      <input type="hidden" name="campaignId" value={campaignId} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="name">Nome</Label>
          <Input id="name" name="name" required />
        </div>
        <div>
          <Label htmlFor="colorHex">Cor</Label>
          <input
            id="colorHex"
            name="colorHex"
            type="color"
            defaultValue="#00AEEF"
            className="h-10 w-full cursor-pointer rounded-lg border border-caetano-medium-gray"
          />
        </div>
      </div>

      <MediaUploadField name="imageMediaId" label="Imagem (opcional)" accept="image/jpeg,image/png,image/webp,image/svg+xml" />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="outcome">Resultado</Label>
          <select
            id="outcome"
            name="outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as "WIN" | "NO_WIN")}
            className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
          >
            <option value="WIN">Vencedor</option>
            <option value="NO_WIN">Não vencedor</option>
          </select>
        </div>
        <div>
          <Label htmlFor="weight">Peso (probabilidade relativa)</Label>
          <Input id="weight" name="weight" type="number" min={1} defaultValue={1} required />
        </div>
      </div>

      {outcome === "WIN" && (
        <div>
          <Label htmlFor="prizeId">Prémio associado</Label>
          <select id="prizeId" name="prizeId" className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm">
            <option value="">Sem prémio</option>
            {prizes.map((prize) => (
              <option key={prize.id} value={prize.id}>
                {prize.publicName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="totalQuantity">Quantidade (stock, opcional)</Label>
          <Input id="totalQuantity" name="totalQuantity" type="number" min={0} />
        </div>
        <div>
          <Label htmlFor="code">Código (opcional)</Label>
          <Input id="code" name="code" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="periodStart">Início do período (opcional)</Label>
          <Input id="periodStart" name="periodStart" type="datetime-local" />
        </div>
        <div>
          <Label htmlFor="periodEnd">Fim do período (opcional)</Label>
          <Input id="periodEnd" name="periodEnd" type="datetime-local" />
        </div>
      </div>

      <div>
        <Label htmlFor="message">Mensagem (opcional)</Label>
        <Input id="message" name="message" />
      </div>

      <label className="flex items-center gap-2 text-sm text-caetano-anthracite">
        <input type="checkbox" name="isActive" defaultChecked className="h-4 w-4 rounded border-caetano-medium-gray" />
        Ativo
      </label>

      <Button type="submit" variant="outline" size="sm">
        Adicionar segmento
      </Button>
    </form>
  );
}
