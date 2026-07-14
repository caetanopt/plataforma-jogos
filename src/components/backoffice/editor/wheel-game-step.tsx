import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  addPrizeAction,
  addPrizeCodeAction,
  removePrizeAction,
  removePrizeCodeAction,
  updatePrizeAction,
} from "@/features/prizes/actions";
import {
  moveWheelSegmentAction,
  removeWheelSegmentAction,
  updateWheelSegmentAction,
} from "@/features/wheel-game/actions";
import { WheelSegmentForm } from "@/components/backoffice/editor/wheel-segment-form";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Badge } from "@/components/ui/badge";

export async function WheelGameStep({ campaignId }: { campaignId: string }) {
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId, type: "WHEEL" },
    include: {
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      prizes: { include: { codes: true } },
    },
  });
  if (!campaign?.wheelConfig) notFound();

  const wheelConfig = campaign.wheelConfig;
  const prizeById = new Map(campaign.prizes.map((p) => [p.id, p]));

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-caetano-anthracite">Configuração da Roda da Sorte</h2>
          <p className="mt-1 text-sm text-caetano-medium-gray">
            Defina os prémios e os segmentos da roda. O resultado é sempre calculado no servidor.
          </p>
        </div>
        <Link
          href={`/apps/${campaignId}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-neutral-100"
        >
          Pré-visualizar
        </Link>
      </div>

      <section className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">
          Prémios ({campaign.prizes.length})
        </h3>

        <ul className="space-y-3">
          {campaign.prizes.map((prize) => (
            <li key={prize.id} className="rounded-lg border border-caetano-medium-gray/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-caetano-anthracite">{prize.publicName}</p>
                  <p className="text-xs text-caetano-medium-gray">
                    {prize.awardedQuantity}/{prize.totalQuantity ?? "∞"} atribuídos ·{" "}
                    {prize.codes.filter((c) => c.status === "AVAILABLE").length} códigos disponíveis
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <details>
                    <summary className="cursor-pointer text-sm text-caetano-cyan">Editar</summary>
                    <form action={updatePrizeAction} className="mt-2 w-72 space-y-2">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="prizeId" value={prize.id} />
                      <Input name="internalName" defaultValue={prize.internalName} placeholder="Nome interno" required />
                      <Input name="publicName" defaultValue={prize.publicName} placeholder="Nome público" required />
                      <Input name="totalQuantity" type="number" min={0} defaultValue={prize.totalQuantity ?? ""} placeholder="Quantidade total" />
                      <Input name="dailyLimit" type="number" min={0} defaultValue={prize.dailyLimit ?? ""} placeholder="Limite diário" />
                      <textarea name="instructions" defaultValue={prize.instructions ?? ""} placeholder="Instruções" rows={2} className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm" />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isActive" defaultChecked={prize.isActive} className="h-4 w-4 rounded border-caetano-medium-gray" />
                        Ativo
                      </label>
                      <Button type="submit" size="sm" variant="outline">Guardar</Button>
                    </form>
                  </details>
                  <form action={removePrizeAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="prizeId" value={prize.id} />
                    <ConfirmSubmitButton confirmMessage={`Eliminar o prémio "${prize.publicName}"?`} size="sm">
                      Eliminar
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>

              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-caetano-medium-gray">
                  Códigos ({prize.codes.length})
                </summary>
                <ul className="mt-2 space-y-1">
                  {prize.codes.map((code) => (
                    <li key={code.id} className="flex items-center justify-between text-xs">
                      <span>
                        {code.code} · {code.status}
                      </span>
                      {code.status === "AVAILABLE" && (
                        <form action={removePrizeCodeAction}>
                          <input type="hidden" name="campaignId" value={campaignId} />
                          <input type="hidden" name="codeId" value={code.id} />
                          <button type="submit" className="text-red-600 hover:underline">
                            Remover
                          </button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
                <form action={addPrizeCodeAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="campaignId" value={campaignId} />
                  <input type="hidden" name="prizeId" value={prize.id} />
                  <Input name="code" placeholder="Novo código" className="h-8" required />
                  <Button type="submit" size="sm" variant="outline">
                    Adicionar
                  </Button>
                </form>
              </details>
            </li>
          ))}
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-caetano-cyan">Adicionar prémio</summary>
          <form action={addPrizeAction} className="mt-2 max-w-md space-y-2">
            <input type="hidden" name="campaignId" value={campaignId} />
            <Input name="internalName" placeholder="Nome interno" required />
            <Input name="publicName" placeholder="Nome público" required />
            <Input name="totalQuantity" type="number" min={0} placeholder="Quantidade total (opcional)" />
            <MediaUploadField name="imageMediaId" label="Imagem (opcional)" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked className="h-4 w-4 rounded border-caetano-medium-gray" />
              Ativo
            </label>
            <Button type="submit" variant="outline" size="sm">
              Adicionar prémio
            </Button>
          </form>
        </details>
      </section>

      <section className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-caetano-anthracite">
          Segmentos ({wheelConfig.segments.length})
        </h3>

        <ul className="space-y-2">
          {wheelConfig.segments.map((segment, index) => (
            <li key={segment.id} className="rounded-lg border border-caetano-medium-gray/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="h-5 w-5 rounded-full border border-caetano-medium-gray/30"
                    style={{ backgroundColor: segment.colorHex }}
                  />
                  <span className="font-medium text-caetano-anthracite">{segment.name}</span>
                  <Badge tone={segment.outcome === "WIN" ? "success" : "neutral"}>
                    {segment.outcome === "WIN" ? "Vencedor" : "Não vencedor"}
                  </Badge>
                  {segment.prizeId && prizeById.get(segment.prizeId) && (
                    <span className="text-xs text-caetano-medium-gray">
                      → {prizeById.get(segment.prizeId)?.publicName}
                    </span>
                  )}
                  {segment.totalQuantity != null && (
                    <span className="text-xs text-caetano-medium-gray">
                      ({segment.remainingQuantity}/{segment.totalQuantity} restantes)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <form action={moveWheelSegmentAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="segmentId" value={segment.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" disabled={index === 0} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para cima">
                      ↑
                    </button>
                  </form>
                  <form action={moveWheelSegmentAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="segmentId" value={segment.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button type="submit" disabled={index === wheelConfig.segments.length - 1} className="rounded px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100 disabled:opacity-30" aria-label="Mover para baixo">
                      ↓
                    </button>
                  </form>
                  <details className="relative">
                    <summary className="cursor-pointer list-none text-sm text-caetano-cyan">Editar</summary>
                    <form
                      action={updateWheelSegmentAction}
                      className="absolute right-0 z-10 mt-1 w-80 space-y-2 rounded-lg border border-caetano-medium-gray/30 bg-white p-3 shadow-lg"
                    >
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="segmentId" value={segment.id} />
                      <Input name="name" defaultValue={segment.name} required />
                      <input type="color" name="colorHex" defaultValue={segment.colorHex} className="h-10 w-full cursor-pointer rounded-lg border border-caetano-medium-gray" />
                      <select name="outcome" defaultValue={segment.outcome} className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm">
                        <option value="WIN">Vencedor</option>
                        <option value="NO_WIN">Não vencedor</option>
                      </select>
                      <select name="prizeId" defaultValue={segment.prizeId ?? ""} className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm">
                        <option value="">Sem prémio</option>
                        {campaign.prizes.map((prize) => (
                          <option key={prize.id} value={prize.id}>
                            {prize.publicName}
                          </option>
                        ))}
                      </select>
                      <Input name="weight" type="number" min={1} defaultValue={segment.weight} required />
                      <Input name="totalQuantity" type="number" min={0} defaultValue={segment.totalQuantity ?? ""} placeholder="Stock (opcional)" />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="isActive" defaultChecked={segment.isActive} className="h-4 w-4 rounded border-caetano-medium-gray" />
                        Ativo
                      </label>
                      <Button type="submit" size="sm" variant="outline">Guardar</Button>
                    </form>
                  </details>
                  <form action={removeWheelSegmentAction}>
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="segmentId" value={segment.id} />
                    <ConfirmSubmitButton confirmMessage="Remover este segmento?" size="sm">
                      Remover
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <WheelSegmentForm
            key={`add-segment-${wheelConfig.segments.length}`}
            campaignId={campaignId}
            prizes={campaign.prizes.map((p) => ({ id: p.id, publicName: p.publicName }))}
          />
        </div>
      </section>
    </div>
  );
}
