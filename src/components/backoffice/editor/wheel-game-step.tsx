import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { prisma } from "@/server/db/client";
import { activeReservationsByPrize } from "@/features/prizes/stock";
import {
  addPrizeAction,
  addPrizeCodeAction,
  removePrizeAction,
  removePrizeCodeAction,
  updatePrizeAction,
} from "@/features/prizes/actions";
import {
  addWheelSegmentAction,
  moveWheelSegmentAction,
  removeWheelSegmentAction,
  updateWheelSegmentAction,
} from "@/features/wheel-game/actions";
import { WheelSegmentForm } from "@/components/backoffice/editor/wheel-segment-form";
import { PrizeForm } from "@/components/backoffice/editor/prize-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { Badge } from "@/components/ui/badge";
import { PRIZE_CODE_STATUS_LABELS } from "@/lib/labels";
import { PRIZE_CODE_LIMITS } from "@/lib/validation/wheel-game";
import { utcToZonedDateTimeLocal } from "@/lib/dates/timezone";
import { cn } from "@/lib/utils";

const SUMMARY_CLASS =
  "cursor-pointer list-none select-none rounded text-sm text-caetano-deep-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan";

const MOVE_BUTTON_CLASS =
  "flex h-8 w-8 cursor-pointer items-center justify-center rounded text-caetano-anthracite-80 transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan active:bg-caetano-medium-gray-40 disabled:pointer-events-none disabled:cursor-default disabled:opacity-30";

/**
 * Código de uma reserva que passou o prazo mas ainda não foi libertada (só um
 * sorteio seguinte a liberta; numa campanha terminada não há): está livre, e
 * remover liberta a reserva primeiro.
 */
function isStuckReservation(
  code: { status: string; award: { status: string; reservationExpiresAt: Date | null } | null },
  now: Date,
): boolean {
  const expiresAt = code.award?.reservationExpiresAt;
  return code.status === "RESERVED" && code.award?.status === "RESERVED" && expiresAt != null && expiresAt <= now;
}

export async function WheelGameStep({ campaignId }: { campaignId: string }) {
  // Mostra códigos de vouchers, pesos e respostas certas: a permissão é
  // verificada aqui também, e não só na página que o inclui.
  const context = await requirePagePermission("campaign:edit");
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId, type: "WHEEL" },
    include: {
      wheelConfig: { include: { segments: { orderBy: { order: "asc" } } } },
      // Ordem estável: sem ela, um prémio editado podia mudar de lugar.
      prizes: {
        orderBy: { id: "asc" },
        include: {
          codes: {
            orderBy: { createdAt: "asc" },
            include: { award: { select: { status: true, reservationExpiresAt: true } } },
          },
          _count: { select: { awards: true } },
        },
      },
    },
  });
  if (!campaign?.wheelConfig) notFound();

  const wheelConfig = campaign.wheelConfig;
  const timeZone = campaign.timezone;
  const prizeById = new Map(campaign.prizes.map((p) => [p.id, p]));
  const prizeOptions = campaign.prizes.map((p) => ({ id: p.id, publicName: p.publicName, isActive: p.isActive }));

  // As imagens gravadas, para os formulários de edição as mostrarem (só da
  // própria organização).
  const mediaIds = [
    ...wheelConfig.segments.map((s) => s.imageMediaId),
    ...campaign.prizes.map((p) => p.imageMediaId),
  ].filter((id): id is string => Boolean(id));
  const media =
    mediaIds.length > 0
      ? await prisma.mediaAsset.findMany({
          where: { id: { in: mediaIds }, organizationId: context.organizationId },
          select: { id: true, url: true, kind: true },
        })
      : [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  // Mesmo instante para todos os códigos da página.
  const now = new Date();
  // Reservas à espera da lead: já saíram na roda, ainda não contam como atribuídas.
  const reservedByPrize = await activeReservationsByPrize(campaign.prizes.map((p) => p.id));

  // Datas dos inputs em hora local da campanha, não na do servidor.
  const toLocalInput = (date: Date | null) => (date ? utcToZonedDateTimeLocal(date, timeZone) : "");
  const formatDateTime = new Intl.DateTimeFormat("pt-PT", { timeZone, dateStyle: "short", timeStyle: "short" });

  return (
    <div className="max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-caetano-anthracite">Configuração da Roda da Sorte</h2>
          <p className="mt-1 text-sm text-caetano-anthracite-80">
            Defina os prémios e os segmentos da roda. O resultado é sempre calculado no servidor.
          </p>
        </div>
        <Link
          href={`/apps/${campaignId}/preview`}
          className="shrink-0 rounded-lg border border-caetano-medium-gray px-3 py-1.5 text-sm text-caetano-anthracite hover:bg-caetano-medium-gray-20"
        >
          Pré-visualizar
        </Link>
      </div>

      <section className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">
          Prémios ({campaign.prizes.length})
        </h3>

        {campaign.prizes.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-anthracite-80">
            Ainda não há prémios. Adicione o primeiro abaixo antes de criar segmentos.
          </p>
        )}

        <ul className="space-y-3">
          {campaign.prizes.map((prize) => {
            const image = prize.imageMediaId ? mediaById.get(prize.imageMediaId) : undefined;
            return (
              <li key={prize.id} className="rounded-lg border border-caetano-medium-gray-20 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-caetano-anthracite">
                      {prize.publicName}
                      {!prize.isActive && <Badge>Inativo</Badge>}
                    </p>
                    <p className="text-xs text-caetano-anthracite-80">
                      {prize.awardedQuantity} atribuídos
                      {(reservedByPrize.get(prize.id) ?? 0) > 0 && ` · ${reservedByPrize.get(prize.id)} reservados`}
                      {" "}/ {prize.totalQuantity ?? "∞"} ·{" "}
                      {prize.codes.filter((c) => c.status === "AVAILABLE").length} códigos disponíveis
                    </p>
                  </div>
                  {/* Um prémio já atribuído guarda o registo de quem o ganhou e não pode ser eliminado. */}
                  {prize._count.awards > 0 ? (
                    <span className="max-w-40 text-right text-xs text-caetano-anthracite-80">
                      Já atribuído, não pode ser eliminado.
                    </span>
                  ) : (
                    <ActionForm action={removePrizeAction} messageClassName="mt-1 max-w-56">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="prizeId" value={prize.id} />
                      <ConfirmSubmitButton
                        confirmMessage={`Eliminar o prémio "${prize.publicName}"? Os segmentos ligados a ele ficam sem prémio.`}
                        size="sm"
                      >
                        Eliminar
                      </ConfirmSubmitButton>
                    </ActionForm>
                  )}
                </div>

                <details className="mt-2">
                  <summary className={SUMMARY_CLASS}>Editar prémio</summary>
                  <div className="mt-2">
                    <PrizeForm
                      action={updatePrizeAction}
                      campaignId={campaignId}
                      timeZone={timeZone}
                      prize={{
                        id: prize.id,
                        internalName: prize.internalName,
                        publicName: prize.publicName,
                        description: prize.description,
                        imageMediaId: prize.imageMediaId,
                        imageUrl: image?.url ?? null,
                        imageKind: image?.kind ?? null,
                        totalQuantity: prize.totalQuantity,
                        // O total não pode descer abaixo do que já saiu (atribuído ou reservado).
                        awardedQuantity: prize.awardedQuantity + (reservedByPrize.get(prize.id) ?? 0),
                        dailyLimit: prize.dailyLimit,
                        instructions: prize.instructions,
                        terms: prize.terms,
                        isActive: prize.isActive,
                        startAt: toLocalInput(prize.startAt),
                        endAt: toLocalInput(prize.endAt),
                      }}
                    />
                  </div>
                </details>

                <details className="mt-2">
                  <summary className={cn(SUMMARY_CLASS, "text-xs text-caetano-anthracite-80")}>
                    Códigos ({prize.codes.length})
                  </summary>
                  {prize.codes.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {prize.codes.map((code) => (
                        <li key={code.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 break-all">
                            <span className="font-mono">{code.code}</span> ·{" "}
                            {isStuckReservation(code, now) ? "Reserva expirada" : PRIZE_CODE_STATUS_LABELS[code.status]}
                            {code.expiresAt && ` · válido até ${formatDateTime.format(code.expiresAt)}`}
                          </span>
                          {/* Só um código livre se remove: reservado ou atribuído já tem dono. */}
                          {(code.status === "AVAILABLE" || isStuckReservation(code, now)) && (
                            <ActionForm action={removePrizeCodeAction} messageClassName="mt-1 max-w-56">
                              <input type="hidden" name="campaignId" value={campaignId} />
                              <input type="hidden" name="codeId" value={code.id} />
                              <SubmitButton
                                variant="ghost"
                                size="sm"
                                className="text-danger"
                                aria-label={`Remover o código ${code.code}`}
                              >
                                Remover
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <ActionForm action={addPrizeCodeAction} className="mt-2 space-y-2">
                    <input type="hidden" name="campaignId" value={campaignId} />
                    <input type="hidden" name="prizeId" value={prize.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`prize-${prize.id}-code`}>Novo código</Label>
                        <Input
                          id={`prize-${prize.id}-code`}
                          name="code"
                          maxLength={PRIZE_CODE_LIMITS.code}
                          autoComplete="off"
                          required
                        />
                      </div>
                      <div>
                        <Label htmlFor={`prize-${prize.id}-expiresAt`}>Validade (opcional)</Label>
                        <Input
                          id={`prize-${prize.id}-expiresAt`}
                          name="expiresAt"
                          type="datetime-local"
                          aria-describedby={`prize-${prize.id}-expiresAt-help`}
                        />
                      </div>
                    </div>
                    <p id={`prize-${prize.id}-expiresAt-help`} className="text-xs text-caetano-anthracite-80">
                      Hora no fuso horário da campanha ({timeZone}). Depois da validade, o código deixa de ser
                      atribuído.
                    </p>
                    <SubmitButton variant="outline" size="sm">
                      Adicionar código
                    </SubmitButton>
                  </ActionForm>
                </details>
              </li>
            );
          })}
        </ul>

        <details className="mt-4">
          <summary className={SUMMARY_CLASS}>Adicionar prémio</summary>
          <div className="mt-2 max-w-xl">
            <PrizeForm action={addPrizeAction} campaignId={campaignId} timeZone={timeZone} />
          </div>
        </details>
      </section>

      <section className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-caetano-anthracite">
          Segmentos ({wheelConfig.segments.length})
        </h3>

        {wheelConfig.segments.length === 0 && (
          <p className="py-4 text-center text-sm text-caetano-anthracite-80">
            Ainda não há segmentos. Adicione o primeiro abaixo.
          </p>
        )}

        <ul className="space-y-2">
          {wheelConfig.segments.map((segment, index) => {
            const image = segment.imageMediaId ? mediaById.get(segment.imageMediaId) : undefined;
            const linkedPrize = segment.prizeId ? prizeById.get(segment.prizeId) : undefined;
            return (
              <li key={segment.id} className="rounded-lg border border-caetano-medium-gray-20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 rounded-full border border-caetano-medium-gray-40"
                      style={{ backgroundColor: segment.colorHex }}
                    />
                    <span className="font-medium text-caetano-anthracite">{segment.name}</span>
                    <Badge tone={segment.outcome === "WIN" ? "success" : "neutral"}>
                      {segment.outcome === "WIN" ? "Vencedor" : "Não vencedor"}
                    </Badge>
                    {!segment.isActive && <Badge>Inativo</Badge>}
                    {linkedPrize && (
                      <span className="text-xs text-caetano-anthracite-80">→ {linkedPrize.publicName}</span>
                    )}
                    {segment.totalQuantity != null && (
                      <span className="text-xs text-caetano-anthracite-80">
                        ({segment.remainingQuantity}/{segment.totalQuantity} restantes)
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-1">
                    <ActionForm action={moveWheelSegmentAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="segmentId" value={segment.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={index === 0}
                        className={MOVE_BUTTON_CLASS}
                        aria-label={`Mover "${segment.name}" para cima`}
                      >
                        ↑
                      </button>
                    </ActionForm>
                    <ActionForm action={moveWheelSegmentAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="segmentId" value={segment.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={index === wheelConfig.segments.length - 1}
                        className={MOVE_BUTTON_CLASS}
                        aria-label={`Mover "${segment.name}" para baixo`}
                      >
                        ↓
                      </button>
                    </ActionForm>
                    <ActionForm action={removeWheelSegmentAction} messageClassName="mt-1 max-w-48">
                      <input type="hidden" name="campaignId" value={campaignId} />
                      <input type="hidden" name="segmentId" value={segment.id} />
                      <ConfirmSubmitButton confirmMessage={`Remover o segmento "${segment.name}"?`} size="sm">
                        Remover
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </div>

                <details className="mt-2">
                  <summary className={SUMMARY_CLASS}>Editar segmento</summary>
                  <div className="mt-2">
                    <WheelSegmentForm
                      action={updateWheelSegmentAction}
                      campaignId={campaignId}
                      prizes={prizeOptions}
                      timeZone={timeZone}
                      segment={{
                        id: segment.id,
                        name: segment.name,
                        colorHex: segment.colorHex,
                        imageMediaId: segment.imageMediaId,
                        imageUrl: image?.url ?? null,
                        imageKind: image?.kind ?? null,
                        outcome: segment.outcome,
                        prizeId: segment.prizeId,
                        weight: segment.weight,
                        totalQuantity: segment.totalQuantity,
                        remainingQuantity: segment.remainingQuantity,
                        periodStart: toLocalInput(segment.periodStart),
                        periodEnd: toLocalInput(segment.periodEnd),
                        message: segment.message,
                        code: segment.code,
                        isActive: segment.isActive,
                      }}
                    />
                  </div>
                </details>
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <h4 className="mb-2 text-sm font-bold text-caetano-anthracite">Novo segmento</h4>
          <WheelSegmentForm
            action={addWheelSegmentAction}
            campaignId={campaignId}
            prizes={prizeOptions}
            timeZone={timeZone}
          />
        </div>
      </section>
    </div>
  );
}
