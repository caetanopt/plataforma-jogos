"use client";

import type { MediaKind } from "@/generated/prisma/client";
import type { FormAction } from "@/lib/forms/action-result";
import { PRIZE_LIMITS } from "@/lib/validation/wheel-game";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox-field";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  CHECKBOX_INPUT_CLASS,
  CHECKBOX_LABEL_CLASS,
  HELP_CLASS,
  TEXTAREA_CLASS,
} from "@/components/backoffice/editor/editor-ui";
import { Plus } from "lucide-react";

/** Valores gravados de um prémio; as datas já vêm em hora local da campanha. */
export interface PrizeFormValues {
  id: string;
  internalName: string;
  publicName: string;
  description: string | null;
  imageMediaId: string | null;
  imageUrl: string | null;
  imageKind: MediaKind | null;
  totalQuantity: number | null;
  /** Já atribuídos mais reservados: o total não pode descer abaixo disto. */
  awardedQuantity: number;
  dailyLimit: number | null;
  instructions: string | null;
  terms: string | null;
  isActive: boolean;
  /** Valor para `datetime-local` no fuso da campanha ("" = sem data). */
  startAt: string;
  endAt: string;
}

interface PrizeFormProps {
  action: FormAction;
  campaignId: string;
  timeZone: string;
  /** Com um prémio, edita-o; sem, adiciona um novo. */
  prize?: PrizeFormValues;
}


/**
 * Formulário de um prémio (§13), o mesmo para adicionar e editar.
 *
 * O de edição não tinha descrição, imagem, termos nem datas, e gravar
 * apagava-os. Agora mostra todos os campos, com os valores gravados.
 */
export function PrizeForm({ action, campaignId, timeZone, prize }: PrizeFormProps) {
  // Um formulário de edição por prémio na página: ids com o id do prémio.
  const fieldId = (name: string) => `prize-${prize?.id ?? "new"}-${name}`;
  const awarded = prize?.awardedQuantity ?? 0;

  return (
    <ActionForm
      action={action}
      // Só o de adicionar limpa (e o reset também esvazia a imagem).
      resetOnSuccess={!prize}
      className="space-y-4"
    >
      <input type="hidden" name="campaignId" value={campaignId} />
      {prize && <input type="hidden" name="prizeId" value={prize.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("internalName")}>Nome interno</Label>
          <Input
            id={fieldId("internalName")}
            name="internalName"
            maxLength={PRIZE_LIMITS.internalName}
            defaultValue={prize?.internalName ?? ""}
            required
          />
        </div>
        <div>
          <Label htmlFor={fieldId("publicName")}>Nome público</Label>
          <Input
            id={fieldId("publicName")}
            name="publicName"
            maxLength={PRIZE_LIMITS.publicName}
            defaultValue={prize?.publicName ?? ""}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor={fieldId("description")}>Descrição (opcional)</Label>
        <textarea
          id={fieldId("description")}
          name="description"
          maxLength={PRIZE_LIMITS.description}
          defaultValue={prize?.description ?? ""}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </div>

      <MediaUploadField
        name="imageMediaId"
        label="Imagem (opcional)"
        defaultMediaId={prize?.imageMediaId}
        defaultUrl={prize?.imageUrl}
        defaultKind={prize?.imageKind}
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("totalQuantity")}>Quantidade total (opcional)</Label>
          <Input
            id={fieldId("totalQuantity")}
            name="totalQuantity"
            type="number"
            inputMode="numeric"
            // O browser já não deixa descer abaixo do que foi atribuído.
            min={awarded}
            max={PRIZE_LIMITS.quantityMax}
            step={1}
            defaultValue={prize?.totalQuantity ?? ""}
            aria-describedby={`${fieldId("totalQuantity")}-help`}
          />
          <p id={`${fieldId("totalQuantity")}-help`} className={HELP_CLASS}>
            {prize ? `Vazio = sem limite. Já atribuídos ou reservados: ${awarded}.` : "Vazio = sem limite."}
          </p>
        </div>
        <div>
          <Label htmlFor={fieldId("dailyLimit")}>Limite diário (opcional)</Label>
          <Input
            id={fieldId("dailyLimit")}
            name="dailyLimit"
            type="number"
            inputMode="numeric"
            min={0}
            max={PRIZE_LIMITS.quantityMax}
            step={1}
            defaultValue={prize?.dailyLimit ?? ""}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={fieldId("instructions")}>Instruções (opcional)</Label>
        <textarea
          id={fieldId("instructions")}
          name="instructions"
          maxLength={PRIZE_LIMITS.instructions}
          defaultValue={prize?.instructions ?? ""}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </div>

      <div>
        <Label htmlFor={fieldId("terms")}>Termos (opcional)</Label>
        <textarea
          id={fieldId("terms")}
          name="terms"
          maxLength={PRIZE_LIMITS.terms}
          defaultValue={prize?.terms ?? ""}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-sm font-medium text-caetano-anthracite">Período (opcional)</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor={fieldId("startAt")} className="font-normal">
              Início
            </Label>
            <Input id={fieldId("startAt")} name="startAt" type="datetime-local" defaultValue={prize?.startAt ?? ""} />
          </div>
          <div>
            <Label htmlFor={fieldId("endAt")} className="font-normal">
              Fim
            </Label>
            <Input id={fieldId("endAt")} name="endAt" type="datetime-local" defaultValue={prize?.endAt ?? ""} />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-caetano-anthracite-80">Horas no fuso horário da campanha ({timeZone}).</p>
      </fieldset>

      <div className="border-t border-caetano-medium-gray-40 pt-4">
        <CheckboxField
          name="isActive"
          defaultChecked={prize?.isActive ?? true}
          className={CHECKBOX_INPUT_CLASS}
          labelClassName={CHECKBOX_LABEL_CLASS}
        >
          Ativo
        </CheckboxField>
        <p className="text-xs leading-relaxed text-caetano-anthracite-80">
          Desativar um prémio ou terminar o seu período retira-o do sorteio: a probabilidade dos outros segmentos
          aumenta.
        </p>
      </div>

      <SubmitButton variant="outline">
        {!prize && <Plus size={16} aria-hidden="true" />}
        {prize ? "Guardar prémio" : "Adicionar prémio"}
      </SubmitButton>
    </ActionForm>
  );
}
