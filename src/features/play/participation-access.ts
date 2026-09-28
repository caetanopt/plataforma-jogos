import type { CampaignType } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { leadMissingBeforePlay, revealPolicy, type RevealPolicy } from "@/features/play/reveal";
import type { GameBlockedReason, ParticipationRef } from "@/features/play/types";

export interface GameGate {
  participationId: string;
  campaignId: string;
  campaignType: CampaignType;
  isTest: boolean;
  sessionId: string | null;
  policy: RevealPolicy;
}

/**
 * Fronteira do servidor para jogar (secções 13 e 16).
 *
 * As ações de jogo são endpoints públicos: podem ser chamadas diretamente,
 * sem passar pelo ecrã. Antes, rodar a roda só verificava o rate limit — dava
 * para jogar sem formulário, com a campanha pausada, ou na participação de
 * outra pessoa. Aqui confirma-se, por esta ordem:
 *
 * 1. Posse: id e token têm de corresponder (ver `ParticipationRef`).
 * 2. Campanha ativa — só quando ainda não há resultado. Repetir um pedido já
 *    resolvido devolve o resultado gravado, mesmo que a campanha tenha
 *    entretanto terminado (idempotência).
 * 3. Formulário antes do jogo: sem ele submetido, não se joga. A idade
 *    mínima, os campos obrigatórios, os consentimentos e os duplicados por
 *    e-mail/telefone são validados nessa submissão.
 */
export async function openGameGate(
  ref: ParticipationRef,
): Promise<{ ok: true; gate: GameGate } | { ok: false; reason: GameBlockedReason }> {
  const participation = await prisma.participation.findFirst({
    where: { id: ref.participationId, idempotencyKey: ref.token },
    select: {
      id: true,
      campaignId: true,
      isTest: true,
      sessionId: true,
      leadFormResponse: true,
      resultSummary: true,
      campaign: {
        select: {
          type: true,
          status: true,
          scheduleStartAt: true,
          scheduleEndAt: true,
          leadForm: { select: { position: true } },
        },
      },
    },
  });
  if (!participation) return { ok: false, reason: "not_found" };

  const alreadyPlayed = participation.resultSummary !== null;
  if (!alreadyPlayed && getEffectivePublicState(participation.campaign) !== "active") {
    return { ok: false, reason: "not_active" };
  }

  const position = participation.campaign.leadForm?.position ?? null;
  const leadSubmitted = participation.leadFormResponse !== null;
  if (leadMissingBeforePlay(position, leadSubmitted)) return { ok: false, reason: "lead_missing" };

  return {
    ok: true,
    gate: {
      participationId: participation.id,
      campaignId: participation.campaignId,
      campaignType: participation.campaign.type,
      isTest: participation.isTest,
      sessionId: participation.sessionId,
      policy: revealPolicy(position, leadSubmitted),
    },
  };
}
