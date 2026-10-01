import type { ReactNode } from "react";
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
import {
  ADD_PANEL_CLASS,
  ICON_BUTTON_CLASS,
  LIST_ITEM_CLASS,
  ListEmpty,
  SectionHeading,
  STEP_CARD_CLASS,
  STEP_CONTENT_CLASS,
  StepHeader,
  SUMMARY_CLASS,
  SummaryChevron,
} from "@/components/backoffice/editor/editor-ui";
import { ArrowDown, ArrowUp, Disc3, Gift, Plus } from "lucide-react";
import { PRIZE_CODE_STATUS_LABELS } from "@/lib/labels";
import { PRIZE_CODE_LIMITS } from "@/lib/validation/wheel-game";
import { utcToZonedDateTimeLocal } from "@/lib/dates/timezone";
import { cn } from "@/lib/utils";

/** "Remover" numa linha: discreto até ao rato, sempre no vermelho funcional de destruição. */
const REMOVE_BUTTON_CLASS = "text-danger hover:bg-danger-surface hover:text-danger-strong active:bg-danger-surface";

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

/** `notice`: um aviso da página, por baixo do título da etapa. */
export async function WheelGameStep({ campaignId, notice }: { campaignId: string; notice?: ReactNode }) {
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
  // Prémios já atribuídos (não se eliminam). Só os desta campanha: o
  // `_count` do Prisma agregava a tabela PrizeAward inteira.
  const awardedPrizeIds = new Set(
    (
      await prisma.prizeAward.groupBy({
        by: ["prizeId"],
        where: { prizeId: { in: campaign.prizes.map((prize) => prize.id) } },
      })
    ).map((row) => row.prizeId),
  );
  // Mesmo instante para todos os códigos da página.
  const now = new Date();
  // Reservas à espera da lead: já saíram na roda, ainda não contam como atribuídas.
  const reservedByPrize = await activeReservationsByPrize(campaign.prizes.map((p) => p.id));

  // Datas dos inputs em hora local da campanha, não na do servidor.
  const toLocalInput = (date: Date | null) => (date ? utcToZonedDateTimeLocal(date, timeZone) : "");
  const formatDateTime = new Intl.DateTimeFormat("pt-PT", { timeZone, dateStyle: "short", timeStyle: "short" });

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Configuração da Roda da Sorte"
        description="Defina os prémios e os segmentos da roda. O resultado é sempre calculado no servidor."
      />

      {notice}

      <section aria-labelledby="wheel-prizes-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <SectionHeading id="wheel-prizes-heading" title={`Prémios (${campaign.prizes.length})`} />

        {campaign.prizes.length === 0 ? (
          <ListEmpty icon={<Gift size={20} />}>
            Ainda não há prémios. Adicione o primeiro abaixo antes de criar segmentos.
          </ListEmpty>
        ) : (
          <ul className="space-y-3">
            {campaign.prizes.map((prize) => {
              const image = prize.imageMediaId ? mediaById.get(prize.imageMediaId) : undefined;
              const reserved = reservedByPrize.get(prize.id) ?? 0;
              const used = prize.awardedQuantity + reserved;
              const usedPercent =
                prize.totalQuantity != null && prize.totalQuantity > 0
                  ? Math.min(100, Math.round((used / prize.totalQuantity) * 100))
                  : null;
              return (
                <li key={prize.id} className={LIST_ITEM_CLASS}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image.url}
                          alt=""
                          className="h-11 w-11 shrink-0 rounded-xl border border-caetano-medium-gray-40 object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-caetano-freedom-yellow-20 text-caetano-deep-blue ring-1 ring-caetano-freedom-yellow-40"
                        >
                          <Gift size={18} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-caetano-anthracite">
                          {prize.publicName}
                          {!prize.isActive && <Badge>Inativo</Badge>}
                        </p>
                        <p className="mt-0.5 text-xs text-caetano-anthracite-80">
                          {prize.awardedQuantity} atribuídos
                          {reserved > 0 && ` · ${reserved} reservados`}
                          {" "}/ {prize.totalQuantity ?? "∞"} ·{" "}
                          {prize.codes.filter((c) => c.status === "AVAILABLE").length} códigos disponíveis
                        </p>
                        {/* O stock já está no texto acima: a barra é só o desenho dele. */}
                        {usedPercent != null && (
                          <div aria-hidden="true" className="mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-caetano-medium-gray-40">
                            <div
                              className="h-full rounded-full bg-linear-to-r from-caetano-deep-blue to-caetano-cyan"
                              style={{ width: `${usedPercent}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    {/* Um prémio já atribuído guarda o registo de quem o ganhou e não pode ser eliminado. */}
                    {awardedPrizeIds.has(prize.id) ? (
                      <span className="text-xs text-caetano-anthracite-80 sm:ml-auto sm:max-w-40 sm:text-right">
                        Já atribuído, não pode ser eliminado.
                      </span>
                    ) : (
                      <ActionForm action={removePrizeAction} messageClassName="mt-1 max-w-56" className="ml-auto">
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="prizeId" value={prize.id} />
                        <ConfirmSubmitButton
                          confirmMessage={`Eliminar o prémio "${prize.publicName}"? Os segmentos ligados a ele ficam sem prémio.`}
                          variant="ghost"
                          size="md"
                          className={REMOVE_BUTTON_CLASS}
                        >
                          Eliminar
                        </ConfirmSubmitButton>
                      </ActionForm>
                    )}
                  </div>

                  <div className="mt-2 border-t border-caetano-medium-gray-20 pt-1">
                    <details className="group">
                      <summary className={SUMMARY_CLASS}>
                        <SummaryChevron />
                        Editar prémio
                      </summary>
                      <div className={cn(ADD_PANEL_CLASS, "mt-2")}>
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

                    <details className="group">
                      <summary className={cn(SUMMARY_CLASS, "text-caetano-anthracite-80 hover:text-caetano-deep-blue")}>
                        <SummaryChevron />
                        Códigos ({prize.codes.length})
                      </summary>
                      <div className={cn(ADD_PANEL_CLASS, "mt-2 space-y-3")}>
                        {prize.codes.length > 0 && (
                          <ul className="divide-y divide-caetano-medium-gray-40 overflow-hidden rounded-lg border border-caetano-medium-gray-40 bg-white">
                            {prize.codes.map((code) => (
                              <li key={code.id} className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
                                <span className="min-w-0 break-all text-caetano-anthracite">
                                  <span className="font-mono font-medium text-caetano-deep-blue">{code.code}</span> ·{" "}
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
                                      className={REMOVE_BUTTON_CLASS}
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
                        <ActionForm action={addPrizeCodeAction} className="space-y-3">
                          <input type="hidden" name="campaignId" value={campaignId} />
                          <input type="hidden" name="prizeId" value={prize.id} />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <Label htmlFor={`prize-${prize.id}-code`}>Novo código</Label>
                              <Input
                                id={`prize-${prize.id}-code`}
                                name="code"
                                maxLength={PRIZE_CODE_LIMITS.code}
                                autoComplete="off"
                                required
                                className="font-mono"
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
                          <p id={`prize-${prize.id}-expiresAt-help`} className="text-xs leading-relaxed text-caetano-anthracite-80">
                            Hora no fuso horário da campanha ({timeZone}). Depois da validade, o código deixa de ser
                            atribuído.
                          </p>
                          <SubmitButton variant="outline">
                            <Plus size={16} aria-hidden="true" />
                            Adicionar código
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <details className="group rounded-xl border border-dashed border-caetano-medium-gray-60 bg-white transition-colors duration-200 open:border-solid open:border-caetano-medium-gray-40 open:bg-caetano-medium-gray-20 hover:border-caetano-deep-blue-40">
          <summary className={cn(SUMMARY_CLASS, "flex w-full justify-center px-4 py-2 group-open:justify-start")}>
            <Plus size={16} aria-hidden="true" className="shrink-0" />
            Adicionar prémio
          </summary>
          <div className="max-w-xl px-3 pb-4 sm:px-4">
            <PrizeForm action={addPrizeAction} campaignId={campaignId} timeZone={timeZone} />
          </div>
        </details>
      </section>

      <section aria-labelledby="wheel-segments-heading" className={cn(STEP_CARD_CLASS, "space-y-4")}>
        <SectionHeading id="wheel-segments-heading" title={`Segmentos (${wheelConfig.segments.length})`} />

        {wheelConfig.segments.length === 0 ? (
          <ListEmpty icon={<Disc3 size={20} />}>Ainda não há segmentos. Adicione o primeiro abaixo.</ListEmpty>
        ) : (
          <ul className="space-y-2">
            {wheelConfig.segments.map((segment, index) => {
              const image = segment.imageMediaId ? mediaById.get(segment.imageMediaId) : undefined;
              const linkedPrize = segment.prizeId ? prizeById.get(segment.prizeId) : undefined;
              return (
                <li key={segment.id} className={LIST_ITEM_CLASS}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-7 w-7 shrink-0 rounded-full shadow-xs ring-2 ring-white outline outline-1 outline-caetano-medium-gray-60"
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
                    <div className="ml-auto flex items-start gap-1">
                      <ActionForm action={moveWheelSegmentAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="segmentId" value={segment.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={index === 0}
                          className={ICON_BUTTON_CLASS}
                          aria-label={`Mover "${segment.name}" para cima`}
                        >
                          <ArrowUp size={16} aria-hidden="true" />
                        </button>
                      </ActionForm>
                      <ActionForm action={moveWheelSegmentAction} resetOnSuccess={false} messageClassName="mt-1 max-w-48">
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="segmentId" value={segment.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={index === wheelConfig.segments.length - 1}
                          className={ICON_BUTTON_CLASS}
                          aria-label={`Mover "${segment.name}" para baixo`}
                        >
                          <ArrowDown size={16} aria-hidden="true" />
                        </button>
                      </ActionForm>
                      <ActionForm action={removeWheelSegmentAction} messageClassName="mt-1 max-w-48">
                        <input type="hidden" name="campaignId" value={campaignId} />
                        <input type="hidden" name="segmentId" value={segment.id} />
                        <ConfirmSubmitButton
                          confirmMessage={`Remover o segmento "${segment.name}"?`}
                          variant="ghost"
                          size="md"
                          className={REMOVE_BUTTON_CLASS}
                        >
                          Remover
                        </ConfirmSubmitButton>
                      </ActionForm>
                    </div>
                  </div>

                  <details className="group mt-2 border-t border-caetano-medium-gray-20 pt-1">
                    <summary className={SUMMARY_CLASS}>
                      <SummaryChevron />
                      Editar segmento
                    </summary>
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
        )}

        <div>
          <h4 className="mb-2 text-sm font-bold text-caetano-deep-blue">Novo segmento</h4>
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
