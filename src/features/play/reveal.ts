import type { CampaignType, LeadFormPosition } from "@/generated/prisma/client";

/**
 * Forma mínima do formulário para decidir se ele entra no fluxo.
 */
export interface LeadFormShape {
  position: LeadFormPosition;
  fieldCount: number;
  consentCount: number;
}

/**
 * Campos que o participante vê. Um campo oculto não se mostra nem se
 * preenche: o valor é o predefinido, posto pelo servidor.
 */
export function visibleFieldCount(fields: readonly { type: string }[]): number {
  return fields.filter((field) => field.type !== "HIDDEN").length;
}

/**
 * Um formulário sem campos visíveis nem consentimentos não faz parte do fluxo: vale
 * "Sem formulário". As campanhas novas nascem com um formulário vazio, e
 * antes o visitante via um ecrã só com "Continuar" e cada participação
 * contava como uma lead sem dados (§20). Usado no servidor e no cliente.
 */
export function effectiveLeadFormPosition(form: LeadFormShape | null | undefined): LeadFormPosition {
  if (!form || form.fieldCount + form.consentCount === 0) return "NONE";
  return form.position;
}

/**
 * Posição que vale para uma participação: a fixada no início (mudar a
 * posição na campanha só afeta participações novas). Desligar ou esvaziar o
 * formulário liberta as participações em curso — o servidor nunca exige um
 * formulário que já não pode receber. Participações anteriores à fixação
 * (null) seguem a posição atual.
 */
export function participationLeadFormPosition(
  pinned: LeadFormPosition | null,
  live: LeadFormShape | null | undefined,
): LeadFormPosition {
  const current = effectiveLeadFormPosition(live);
  if (current === "NONE") return "NONE";
  return pinned ?? current;
}

/**
 * Que parte do resultado pode chegar ao browser, dada a posição do
 * formulário de leads e se ele já foi submetido (secção 11).
 *
 * O resultado é sempre calculado no servidor (na roda com "antes do
 * resultado", só depois do formulário); o que muda é o que se devolve e
 * quando:
 * - "Antes de revelar o resultado": nada;
 * - "Antes de revelar o prémio": se ganhou, mas não o quê;
 * - "Depois do jogo", na roda: o prémio, mas não o código nem as
 *   instruções. O código é um valor resgatável que o parceiro valida fora da
 *   plataforma: chegava ao ecrã (e à rede) antes de o servidor verificar
 *   duplicados e idade, e quem fechasse o separador ficava com ele.
 */
export type RevealPolicy = "full" | "withhold_result" | "withhold_prize" | "withhold_code";

export function revealPolicy(
  position: LeadFormPosition | null,
  leadSubmitted: boolean,
  campaignType: CampaignType,
): RevealPolicy {
  if (leadSubmitted) return "full";
  if (position === "BEFORE_RESULT") return "withhold_result";
  if (position === "BEFORE_PRIZE") return "withhold_prize";
  if (position === "AFTER_GAME" && campaignType === "WHEEL") return "withhold_code";
  return "full";
}

/** Com o formulário antes do jogo, não se joga sem o submeter. */
export function leadMissingBeforePlay(position: LeadFormPosition | null, leadSubmitted: boolean): boolean {
  return position === "BEFORE_GAME" && !leadSubmitted;
}

/**
 * Com o formulário depois do sorteio e ainda por submeter, o prémio fica
 * reservado em vez de atribuído (ver features/prizes/reservation.ts).
 */
export function holdsPrizeUntilLead(position: LeadFormPosition, leadSubmitted: boolean, isTest: boolean): boolean {
  if (isTest || leadSubmitted) return false;
  return position === "AFTER_GAME" || position === "BEFORE_PRIZE";
}

/**
 * Estado de entrega do prémio saído: `test` (modo de teste, nada real),
 * `reserved` (à espera da lead), `confirmed` (atribuído), `released`
 * (perdido: lead recusada, ou prazo terminado sem stock para o repor).
 */
export type PrizeDelivery = "none" | "test" | "reserved" | "confirmed" | "released";

interface WheelOutcome {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: { publicName: string; instructions: string | null } | null;
  delivery: PrizeDelivery;
  code: string | null;
}

export interface ProjectedWheelOutcome {
  segmentId: string;
  segmentName: string;
  outcome: "WIN" | "NO_WIN";
  message: string | null;
  prize: { publicName: string; instructions: string | null; code: string | null } | null;
  /** Há um prémio (ou parte dele) à espera do formulário. */
  prizePending: boolean;
  /** Saiu um prémio, mas já não pode ser entregue. */
  prizeUnavailable: boolean;
}

/**
 * Projeção explícita do que segue para o browser: nunca o id interno do
 * prémio, e o código só quando o prémio está atribuído.
 */
export function projectWheelOutcome(
  result: WheelOutcome,
  policy: Exclude<RevealPolicy, "withhold_result">,
): ProjectedWheelOutcome {
  const base = {
    segmentId: result.segmentId,
    segmentName: result.segmentName,
    outcome: result.outcome,
    message: result.message,
  };
  const won = result.prize !== null;

  if (policy === "withhold_prize") {
    return { ...base, prize: null, prizePending: won, prizeUnavailable: false };
  }
  if (policy === "withhold_code") {
    return {
      ...base,
      prize: result.prize ? { publicName: result.prize.publicName, instructions: null, code: null } : null,
      prizePending: won,
      prizeUnavailable: false,
    };
  }

  if (!result.prize) return { ...base, prize: null, prizePending: false, prizeUnavailable: false };
  if (result.delivery === "released") return { ...base, prize: null, prizePending: false, prizeUnavailable: true };
  // Formulário aceite mas reserva ainda por confirmar (não devia acontecer):
  // nada de resgatável segue, e o ecrã volta a pedir.
  if (result.delivery === "reserved") return { ...base, prize: null, prizePending: true, prizeUnavailable: false };
  return {
    ...base,
    prize: {
      publicName: result.prize.publicName,
      instructions: result.prize.instructions,
      code: result.delivery === "confirmed" ? result.code : null,
    },
    prizePending: false,
    prizeUnavailable: false,
  };
}
