import type { Prisma } from "@/generated/prisma/client";

type LeadParticipation = Prisma.ParticipationGetPayload<{
  include: {
    campaign: { select: { internalName: true; type: true } };
    participant: true;
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
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  deviceType: string;
  browser: string;
  os: string;
  sessionId: string;
}

function fullName(participant: LeadParticipation["participant"]): string {
  if (!participant) return "";
  return [participant.firstName, participant.lastName].filter(Boolean).join(" ");
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

export function toLeadRow(p: LeadParticipation): LeadRow {
  const { result, score, timeSeconds } = summarizeResult(p);
  return {
    id: p.id,
    createdAt: p.createdAt,
    status: p.status,
    isTest: p.isTest,
    campaignId: p.campaignId,
    campaignName: p.campaign.internalName,
    campaignType: p.campaign.type,
    name: fullName(p.participant),
    email: p.participant?.email ?? "",
    phone: p.participant?.phone ?? "",
    result,
    score,
    timeSeconds,
    prize: p.prizeAward?.prize.publicName ?? "",
    code: p.prizeAward?.prizeCode?.code ?? "",
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
];

function escapeCsvValue(value: unknown): string {
  const str = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function leadsToCsv(rows: LeadRow[]): string {
  const header = CSV_COLUMNS.map(([, label]) => escapeCsvValue(label)).join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map(([key]) => escapeCsvValue(row[key])).join(","));
  return [header, ...lines].join("\n");
}
