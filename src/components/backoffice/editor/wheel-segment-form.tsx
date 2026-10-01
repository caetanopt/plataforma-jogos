"use client";

import { useState } from "react";
import type { MediaKind } from "@/generated/prisma/client";
import type { FormAction } from "@/lib/forms/action-result";
import { WHEEL_SEGMENT_LIMITS } from "@/lib/validation/wheel-game";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  ADD_PANEL_CLASS,
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_LABEL_CLASS,
  HELP_CLASS,
  SELECT_CLASS,
  SelectShell,
} from "@/components/backoffice/editor/editor-ui";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

export interface SegmentPrizeOption {
  id: string;
  publicName: string;
  isActive: boolean;
}

/** Valores gravados de um segmento; as datas já vêm em hora local da campanha. */
export interface WheelSegmentFormValues {
  id: string;
  name: string;
  colorHex: string;
  imageMediaId: string | null;
  imageUrl: string | null;
  imageKind: MediaKind | null;
  outcome: "WIN" | "NO_WIN";
  prizeId: string | null;
  weight: number;
  totalQuantity: number | null;
  remainingQuantity: number | null;
  /** Valor para `datetime-local` no fuso da campanha ("" = sem data). */
  periodStart: string;
  periodEnd: string;
  message: string | null;
  code: string | null;
  isActive: boolean;
}

interface WheelSegmentFormProps {
  action: FormAction;
  campaignId: string;
  prizes: ReadonlyArray<SegmentPrizeOption>;
  timeZone: string;
  /** Com um segmento, edita-o; sem, adiciona um novo. */
  segment?: WheelSegmentFormValues;
}


/**
 * Formulário de um segmento da roda, o mesmo para adicionar e editar.
 *
 * O de edição tinha só metade dos campos, e a ação gravava os que faltavam
 * como vazios: guardar o peso apagava a imagem, a mensagem, o código e o
 * período. Agora mostra todos, com os valores gravados.
 */
export function WheelSegmentForm({ action, campaignId, prizes, timeZone, segment }: WheelSegmentFormProps) {
  return (
    <ActionForm
      action={action}
      // Só o de adicionar limpa: o de edição fica com os valores gravados.
      resetOnSuccess={!segment}
      className={cn(ADD_PANEL_CLASS, "space-y-4")}
    >
      <input type="hidden" name="campaignId" value={campaignId} />
      {segment && <input type="hidden" name="segmentId" value={segment.id} />}
      <SegmentFields prizes={prizes} timeZone={timeZone} segment={segment} />
    </ActionForm>
  );
}

/**
 * Os campos ficam dentro do ActionForm para que o reset depois de adicionar
 * também reponha o resultado escolhido (estado deste componente).
 */
function SegmentFields({
  prizes,
  timeZone,
  segment,
}: {
  prizes: ReadonlyArray<SegmentPrizeOption>;
  timeZone: string;
  segment?: WheelSegmentFormValues;
}) {
  const [outcome, setOutcome] = useState<"WIN" | "NO_WIN">(segment?.outcome ?? "WIN");
  // Há um formulário de edição por segmento na página: os ids levam o id do
  // segmento. O de adicionar mantém os ids simples (usados nos testes e2e).
  const fieldId = (name: string) => (segment ? `segment-${segment.id}-${name}` : name);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div>
          <Label htmlFor={fieldId("name")}>Nome</Label>
          <Input
            id={fieldId("name")}
            name="name"
            maxLength={WHEEL_SEGMENT_LIMITS.name}
            defaultValue={segment?.name ?? ""}
            required
          />
        </div>
        <div>
          <Label htmlFor={fieldId("colorHex")}>Cor</Label>
          <input
            id={fieldId("colorHex")}
            name="colorHex"
            type="color"
            defaultValue={segment?.colorHex ?? "#00AEEF"}
            className={cn(
              "h-10 w-full cursor-pointer rounded-lg border border-caetano-anthracite-60 bg-white p-1 shadow-xs",
              "transition-[border-color,box-shadow] duration-200 hover:border-caetano-anthracite-80",
              "focus-visible:border-caetano-deep-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan",
              "[&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0",
            )}
          />
        </div>
      </div>

      <MediaUploadField
        name="imageMediaId"
        label="Imagem (opcional)"
        defaultMediaId={segment?.imageMediaId}
        defaultUrl={segment?.imageUrl}
        defaultKind={segment?.imageKind}
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("outcome")}>Resultado</Label>
          <SelectShell>
            <select
              id={fieldId("outcome")}
              name="outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value === "NO_WIN" ? "NO_WIN" : "WIN")}
              className={SELECT_CLASS}
            >
              <option value="WIN">Vencedor</option>
              <option value="NO_WIN">Não vencedor</option>
            </select>
          </SelectShell>
        </div>
        <div>
          <Label htmlFor={fieldId("weight")}>Peso (probabilidade relativa)</Label>
          <Input
            id={fieldId("weight")}
            name="weight"
            type="number"
            inputMode="numeric"
            min={WHEEL_SEGMENT_LIMITS.weightMin}
            max={WHEEL_SEGMENT_LIMITS.weightMax}
            step={1}
            defaultValue={segment?.weight ?? 1}
            aria-describedby={`${fieldId("weight")}-help`}
            required
          />
          <p id={`${fieldId("weight")}-help`} className={HELP_CLASS}>
            De {WHEEL_SEGMENT_LIMITS.weightMin} a {WHEEL_SEGMENT_LIMITS.weightMax}. O tamanho do segmento na roda não
            conta.
          </p>
        </div>
      </div>

      {/* Um segmento que não ganha nunca leva prémio: o campo nem vai no envio. */}
      {outcome === "WIN" && (
        <div>
          <Label htmlFor={fieldId("prizeId")}>Prémio associado</Label>
          <SelectShell>
            <select
              id={fieldId("prizeId")}
              name="prizeId"
              defaultValue={segment?.prizeId ?? ""}
              className={SELECT_CLASS}
            >
              <option value="">Sem prémio</option>
              {prizes.map((prize) => (
                <option key={prize.id} value={prize.id}>
                  {prize.isActive ? prize.publicName : `${prize.publicName} (inativo)`}
                </option>
              ))}
            </select>
          </SelectShell>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("totalQuantity")}>Stock do segmento (opcional)</Label>
          <Input
            id={fieldId("totalQuantity")}
            name="totalQuantity"
            type="number"
            inputMode="numeric"
            min={0}
            max={WHEEL_SEGMENT_LIMITS.quantityMax}
            step={1}
            defaultValue={segment?.totalQuantity ?? ""}
            aria-describedby={`${fieldId("totalQuantity")}-help`}
          />
          <p id={`${fieldId("totalQuantity")}-help`} className={HELP_CLASS}>
            {segment?.totalQuantity != null
              ? `Restam ${segment.remainingQuantity ?? 0} de ${segment.totalQuantity}. Vazio = sem limite.`
              : "Vazio = sem limite."}
          </p>
        </div>
        <div>
          <Label htmlFor={fieldId("code")}>Código (opcional)</Label>
          <Input
            id={fieldId("code")}
            name="code"
            maxLength={WHEEL_SEGMENT_LIMITS.code}
            defaultValue={segment?.code ?? ""}
          />
        </div>
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-medium text-caetano-anthracite">Período (opcional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={fieldId("periodStart")} className="font-normal">
              Início
            </Label>
            <Input
              id={fieldId("periodStart")}
              name="periodStart"
              type="datetime-local"
              defaultValue={segment?.periodStart ?? ""}
            />
          </div>
          <div>
            <Label htmlFor={fieldId("periodEnd")} className="font-normal">
              Fim
            </Label>
            <Input
              id={fieldId("periodEnd")}
              name="periodEnd"
              type="datetime-local"
              defaultValue={segment?.periodEnd ?? ""}
            />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-caetano-anthracite-80">Horas no fuso horário da campanha ({timeZone}).</p>
      </fieldset>

      <div>
        <Label htmlFor={fieldId("message")}>Mensagem (opcional)</Label>
        <Input
          id={fieldId("message")}
          name="message"
          maxLength={WHEEL_SEGMENT_LIMITS.message}
          defaultValue={segment?.message ?? ""}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-caetano-medium-gray-40 pt-4">
        <CheckboxField
          name="isActive"
          defaultChecked={segment?.isActive ?? true}
          className={CHECKBOX_INPUT_CLASS}
          labelClassName={CHECKBOX_LABEL_CLASS}
        >
          Ativo
        </CheckboxField>

        <SubmitButton variant="outline">
          {!segment && <Plus size={16} aria-hidden="true" />}
          {segment ? "Guardar segmento" : "Adicionar segmento"}
        </SubmitButton>
      </div>
    </>
  );
}
