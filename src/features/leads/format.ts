import type { Prisma } from "@/generated/prisma/client";

type LeadParticipation = Prisma.ParticipationGetPayload<{
  include: {
    campaign: { select: { internalName: true; type: true } };
    prizeAward: { include: { prize: true; prizeCode: true } };
  };
}>;

export interface LeadRow {
  id: string;
  createdAt: Date;
  status: string;
  isTest: boolean;
  campaignId: string;
  campaignName: string;
  campaignType: string;
  name: string;
  email: string;
  phone: string;
  result: string;
  score: string;
  timeSeconds: string;
  prize: string;
  code: string;
  /** Atribuído, reservado ou não atribuído (com o motivo); vazio sem prémio. */
  prizeStatus: string;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  deviceType: string;
  browser: string;
  os: string;
  sessionId: string;
}

/**
 * A identidade é a desta participação. O Participant é partilhado por quem
 * usa o mesmo browser e, lido daí, todas as leads de um quiosque mostravam a
 * última pessoa.
 */
function fullName(p: Pick<LeadParticipation, "firstName" | "lastName">): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

function summarizeResult(p: LeadParticipation): { result: string; score: string; timeSeconds: string } {
  const summary = p.resultSummary as Record<string, unknown> | null;
  if (!summary) return { result: "", score: "", timeSeconds: "" };

  if (p.campaign.type === "WHEEL") {
    return { result: String(summary.outcome ?? ""), score: "", timeSeconds: "" };
  }
  if (p.campaign.type === "MEMORY") {
    return {
      result: summary.completed ? "Concluído" : "Não concluído",
      score: String(summary.score ?? ""),
      timeSeconds: "",
    };
  }
  if (p.campaign.type === "QUIZ") {
    return {
      result: summary.passed === true ? "Aprovado" : summary.passed === false ? "Reprovado" : "",
      score: String(summary.percentage ?? ""),
      timeSeconds: "",
    };
  }
  return { result: "", score: "", timeSeconds: "" };
}

const RELEASE_LABELS: Record<string, string> = {
  EXPIRED: "Não atribuído (formulário fora do prazo)",
  DUPLICATE: "Não atribuído (lead duplicada)",
  BOT: "Não atribuído (bot)",
};

/**
 * Prémio e código só quando o prémio foi mesmo atribuído. O código de uma
 * reserva (ativa ou libertada) nunca aparece nem é exportado: pode vir a
 * ser entregue a outra pessoa.
 */
function prizeColumns(p: LeadParticipation, now: Date): Pick<LeadRow, "prize" | "code" | "prizeStatus"> {
  const award = p.prizeAward;
  if (!award) return { prize: "", code: "", prizeStatus: "" };
  if (award.status === "CONFIRMED") {
    return { prize: award.prize.publicName, code: award.prizeCode?.code ?? "", prizeStatus: "Atribuído" };
  }
  if (award.status === "RESERVED") {
    const active = award.reservationExpiresAt != null && award.reservationExpiresAt > now;
    return {
      prize: "",
      code: "",
      prizeStatus: active ? "Reservado (a aguardar a lead)" : RELEASE_LABELS.EXPIRED,
    };
  }
  return { prize: "", code: "", prizeStatus: RELEASE_LABELS[award.releaseReason ?? "EXPIRED"] ?? "Não atribuído" };
}

export function toLeadRow(p: LeadParticipation, now: Date = new Date()): LeadRow {
  const { result, score, timeSeconds } = summarizeResult(p);
  return {
    id: p.id,
    createdAt: p.createdAt,
    status: p.status,
    isTest: p.isTest,
    campaignId: p.campaignId,
    campaignName: p.campaign.internalName,
    campaignType: p.campaign.type,
    name: fullName(p),
    email: p.email ?? "",
    phone: p.phone ?? "",
    result,
    score,
    timeSeconds,
    ...prizeColumns(p, now),
    source: p.source ?? "",
    utmSource: p.utmSource ?? "",
    utmMedium: p.utmMedium ?? "",
    utmCampaign: p.utmCampaign ?? "",
    deviceType: p.deviceType ?? "",
    browser: p.browser ?? "",
    os: p.os ?? "",
    sessionId: p.sessionId ?? "",
  };
}

const CSV_COLUMNS: Array<[keyof LeadRow, string]> = [
  ["id", "ID"],
  ["createdAt", "Data"],
  ["status", "Estado"],
  ["campaignName", "Campanha"],
  ["campaignType", "Tipo"],
  ["name", "Nome"],
  ["email", "E-mail"],
  ["phone", "Telefone"],
  ["result", "Resultado"],
  ["score", "Pontuação"],
  ["prize", "Prémio"],
  ["code", "Código"],
  ["source", "Origem"],
  ["utmSource", "UTM Source"],
  ["utmMedium", "UTM Medium"],
  ["utmCampaign", "UTM Campaign"],
  ["deviceType", "Dispositivo"],
  ["browser", "Browser"],
  ["os", "SO"],
  ["isTest", "Teste"],
  // No fim, para não mudar a posição das colunas que já existiam.
  ["prizeStatus", "Estado do prémio"],
];

/**
 * Um valor que comece por =, +, -, @, tab ou CR é interpretado como fórmula
 * pelo Excel e pelo Sheets (injeção de fórmulas, §25): o nome ou a resposta
 * de um participante podia correr uma fórmula no computador de quem abre a
 * exportação. Um apóstrofo à frente torna-o texto. Números simples (um
 * telefone "+351912345678") ficam como estão.
 */
function neutralizeFormula(str: string): string {
  if (!/^[=+\-@\t\r]/.test(str)) return str;
  if (/^[+-]?\d[\d\s.]*$/.test(str)) return str;
  return `'${str}`;
}

function escapeCsvValue(value: unknown): string {
  const str = neutralizeFormula(value instanceof Date ? value.toISOString() : String(value ?? ""));
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function leadsToCsv(rows: LeadRow[]): string {
  const header = CSV_COLUMNS.map(([, label]) => escapeCsvValue(label)).join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map(([key]) => escapeCsvValue(row[key])).join(","));
  return [header, ...lines].join("\n");
}
