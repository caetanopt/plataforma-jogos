import { timingSafeEqual } from "node:crypto";
import type { CampaignType } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { participationRefSchema } from "@/lib/validation/play";
import { getEffectivePublicState } from "@/features/publishing/public-status";
import { leadMissingBeforePlay, revealPolicy, type RevealPolicy } from "@/features/play/reveal";
import type { GameBlockedReason, ParticipationRef } from "@/features/play/types";

/**
 * Compara o token recebido com a chave gravada. Só depois de o ler pelo id,
 * e nunca como condição do `where`: um valor que não seja uma string não
 * pode transformar-se num filtro. Comparação em tempo constante.
 */
export function tokenMatches(stored: string, received: unknown): boolean {
  if (typeof received !== "string") return false;
  const a = Buffer.from(stored);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Valida a forma do ParticipationRef recebido do browser. */
export function parseParticipationRef(ref: unknown): ParticipationRef | null {
  const parsed = participationRefSchema.safeParse(ref);
  return parsed.success ? parsed.data : null;
}

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
 * 1. Posse: id e token têm de corresponder (ver `ParticipationRef`), com a
 *    forma validada antes de tocar na base de dados.
 * 2. Roda: campanha ativa quando ainda não há resultado — sortear consome
 *    stock e atribui códigos, e isso não pode acontecer com a campanha
 *    pausada ou terminada. Repetir um pedido já resolvido devolve o
 *    resultado gravado (idempotência). Memória e quiz não têm prémios: quem
 *    começou enquanto a campanha estava ativa pode acabar, em vez de perder
 *    as respostas porque ela terminou a meio do jogo.
 * 3. Formulário antes do jogo: sem ele submetido, não se joga. A idade
 *    mínima, os campos obrigatórios, os consentimentos e os duplicados por
 *    e-mail/telefone são validados nessa submissão.
 */
export async function openGameGate(
  rawRef: unknown,
): Promise<{ ok: true; gate: GameGate } | { ok: false; reason: GameBlockedReason }> {
  const ref = parseParticipationRef(rawRef);
  if (!ref) return { ok: false, reason: "not_found" };

  const participation = await prisma.participation.findUnique({
    where: { id: ref.participationId },
    select: {
      id: true,
      idempotencyKey: true,
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
  if (!participation || !tokenMatches(participation.idempotencyKey, ref.token)) {
    return { ok: false, reason: "not_found" };
  }

  const alreadyPlayed = participation.resultSummary !== null;
  if (
    participation.campaign.type === "WHEEL" &&
    !alreadyPlayed &&
    getEffectivePublicState(participation.campaign) !== "active"
  ) {
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
