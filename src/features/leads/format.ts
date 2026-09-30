import type { Prisma } from "@/generated/prisma/client";

type LeadParticipation = Prisma.ParticipationGetPayload<{
  include: {
    campaign: { select: { internalName: true; type: true } };
    prizeAward: { include: { prize: true; prizeCode: true } };
    consentRecords: {
      select: {
        consentDefinitionId: true;
        status: true;
        text: true;
        version: true;
        grantedAt: true;
        consentDefinition: { select: { isMarketing: true; order: true } };
      };
    };
  };
}>;

type LeadConsentRecord = LeadParticipation["consentRecords"][number];

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
  /** "Concedido", "Recusado" ou "Parcial" (vários de marketing); vazio sem nenhum. */
  marketingConsent: string;
  /** Cada consentimento com o texto, a versão, o estado e a data. */
  consents: string;
  /** Estado e versão do último registo de cada consentimento (colunas por consentimento). */
  consentStatusByDefinition: Record<string, { status: string; version: number }>;
  /** Data da anonimização (ISO); vazio numa participação com os dados. */
  anonymizedAt: string;
}

export const CONSENT_STATUS_LABELS: Record<string, string> = {
  GRANTED: "Aceite",
  DECLINED: "Recusado",
  WITHDRAWN: "Retirado",
};

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** O registo mais recente de cada consentimento (uma retirada vem depois). */
function latestByDefinition(records: readonly LeadConsentRecord[]): Map<string, LeadConsentRecord> {
  const latest = new Map<string, LeadConsentRecord>();
  for (const record of records) {
    const current = latest.get(record.consentDefinitionId);
    if (!current || record.grantedAt >= current.grantedAt) latest.set(record.consentDefinitionId, record);
  }
  return latest;
}

function consentColumns(records: readonly LeadConsentRecord[]): Pick<
  LeadRow,
  "marketingConsent" | "consents" | "consentStatusByDefinition"
> {
  const latest = [...latestByDefinition(records).values()];
  const marketing = latest.filter((record) => record.consentDefinition.isMarketing);
  const granted = marketing.filter((record) => record.status === "GRANTED").length;
  const marketingConsent =
    marketing.length === 0 ? "" : granted === marketing.length ? "Concedido" : granted === 0 ? "Recusado" : "Parcial";

  return {
    marketingConsent,
    consents: latest
      .map(
        (record) =>
          `«${truncate(record.text, 80)}» (v${record.version}): ${CONSENT_STATUS_LABELS[record.status] ?? record.status} em ${record.grantedAt.toISOString()}`,
      )
      .join(" | "),
    consentStatusByDefinition: Object.fromEntries(
      latest.map((record) => [record.consentDefinitionId, { status: CONSENT_STATUS_LABELS[record.status] ?? record.status, version: record.version }]),
    ),
  };
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
    ...consentColumns(p.consentRecords),
    anonymizedAt: p.anonymizedAt?.toISOString() ?? "",
  };
}

type CsvColumnKey = Exclude<keyof LeadRow, "consentStatusByDefinition">;

const CSV_COLUMNS: Array<[CsvColumnKey, string]> = [
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
  ["marketingConsent", "Consentimento de marketing"],
  ["consents", "Consentimentos"],
  ["anonymizedAt", "Anonimizada em"],
];

/** Uma coluna por consentimento do formulário (exportação de uma campanha). */
export interface ConsentCsvColumn {
  definitionId: string;
  text: string;
  version: number;
}

function consentHeader(column: ConsentCsvColumn): string {
  return `Consentimento: ${truncate(column.text, 60)} (v${column.version})`;
}

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

/**
 * O estado do consentimento, com a versão aceite quando não é a atual do
 * cabeçalho: um "Aceite" debaixo do texto v2 não pode passar por aceitação
 * do texto v2 se a pessoa aceitou o v1.
 */
function consentCell(row: LeadRow, column: ConsentCsvColumn): string {
  const recorded = row.consentStatusByDefinition[column.definitionId];
  if (!recorded) return "";
  return recorded.version === column.version ? recorded.status : `${recorded.status} (v${recorded.version})`;
}

/** Linha de cabeçalho do CSV (sem a quebra de linha). */
export function csvHeader(consentColumns: readonly ConsentCsvColumn[] = []): string {
  return [...CSV_COLUMNS.map(([, label]) => label), ...consentColumns.map((column) => consentHeader(column))]
    .map(escapeCsvValue)
    .join(",");
}

/** Uma linha do CSV (sem a quebra de linha). */
export function csvLine(row: LeadRow, consentColumns: readonly ConsentCsvColumn[] = []): string {
  return [
    ...CSV_COLUMNS.map(([key]) => row[key]),
    ...consentColumns.map((column) => consentCell(row, column)),
  ]
    .map(escapeCsvValue)
    .join(",");
}

export function leadsToCsv(rows: LeadRow[], consentColumns: readonly ConsentCsvColumn[] = []): string {
  return [csvHeader(consentColumns), ...rows.map((row) => csvLine(row, consentColumns))].join("\n");
}
