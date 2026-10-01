import type { CampaignType, LeadFieldType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  findSubjectLegacyParticipants,
  findSubjectParticipations,
  type SubjectIdentifier,
} from "@/features/leads/queries";
import { CONSENT_STATUS_LABELS, describePrizeAward } from "@/features/leads/format";
import { readLegalLinks, type LegalLinks } from "@/features/brand/legal-links";
import {
  anonymizationDate,
  describeRetention,
  effectiveRetention,
  type EffectiveRetention,
} from "@/features/privacy/retention-policy";
import { CAMPAIGN_TYPE_LABELS, PARTICIPATION_STATUS_LABELS } from "@/lib/labels";

/**
 * Exportação dos dados de um titular (direito de acesso e portabilidade,
 * RGPD arts. 15.º e 20.º; §24 "exportação do titular").
 *
 * Um ficheiro JSON com tudo o que a organização guarda sobre a pessoa:
 * as participações com o e-mail ou o telefone exatos (as mesmas que o
 * pedido de eliminação anonimiza — findSubjectParticipations), cada uma com
 * a identidade, as respostas ao formulário, os consentimentos, o resultado,
 * o prémio, a origem e o dispositivo; os dados antigos de participante; e,
 * por campanha, os links legais e o prazo de conservação (art. 15.º, n.º 1).
 *
 * As chaves são texto em português: o ficheiro é para ser lido pelo titular,
 * e continua a ser um formato estruturado e de leitura automática.
 *
 * Nunca sai o token da participação (idempotencyKey) nem o cookie do browser
 * (Participant.cookieId): são chaves de acesso — com elas retomava-se a
 * participação —, não dados sobre a pessoa. O cookie é também partilhado por
 * quem usa o mesmo browser.
 */

/** Participações lidas por lote. */
const BATCH_SIZE = 100;

const participationInclude = {
  consentRecords: {
    select: { status: true, text: true, version: true, source: true, grantedAt: true },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
  },
  prizeAward: {
    select: {
      status: true,
      reservationExpiresAt: true,
      releaseReason: true,
      confirmedAt: true,
      prize: { select: { publicName: true, instructions: true } },
      prizeCode: { select: { code: true, expiresAt: true } },
    },
  },
  memoryResult: { select: { timeSeconds: true, attempts: true, pairsFound: true, score: true, completed: true } },
  quizResponse: {
    select: { answers: true, totalScore: true, percentage: true, passed: true, resultProfileId: true, timeSeconds: true },
  },
} satisfies Prisma.ParticipationInclude;

export type ExportedParticipationRow = Prisma.ParticipationGetPayload<{ include: typeof participationInclude }>;

/** O que é preciso de cada campanha para pôr nomes nas respostas. */
export interface SubjectExportCampaign {
  id: string;
  name: string;
  type: CampaignType;
  timezone: string;
  legalLinks: LegalLinks;
  retention: EffectiveRetention;
  /** Campos do formulário, pela ordem do editor, por identificador interno. */
  fields: Array<{ internalKey: string; label: string; type: LeadFieldType }>;
  /** Perguntas do quiz, com as respostas; e os títulos dos perfis. */
  questions: Map<string, { title: string; answers: Map<string, string> }>;
  profiles: Map<string, string>;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const iso = (date: Date | null | undefined): string | null => date?.toISOString() ?? null;
const yesNo = (value: boolean | null | undefined): string | null => (value == null ? null : value ? "Sim" : "Não");

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * As respostas ao formulário com o nome de cada campo. Um campo removido
 * do formulário depois da participação fica com o identificador interno.
 */
export function formAnswers(response: unknown, campaign: SubjectExportCampaign): Json {
  const values = asRecord(response);
  if (!values) return null;
  const known = new Set(campaign.fields.map((field) => field.internalKey));
  const answers: Json[] = [];
  const answer = (label: string, value: unknown, type?: LeadFieldType) => {
    const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    answers.push({
      Campo: label,
      Resposta: type === "CHECKBOX" || type === "TERMS_ACCEPTANCE" ? (text === "true" ? "Sim" : text === "false" ? "Não" : text) : text,
    });
  };
  for (const field of campaign.fields) {
    if (field.internalKey in values) answer(field.label, values[field.internalKey], field.type);
  }
  for (const [key, value] of Object.entries(values)) {
    if (!known.has(key)) answer(key, value);
  }
  return answers;
}

function quizResult(participation: ExportedParticipationRow, campaign: SubjectExportCampaign): Json {
  const response = participation.quizResponse;
  if (!response) return null;
  const summary = asRecord(participation.resultSummary);
  const perQuestion = new Map<string, { correct: unknown; points: unknown }>();
  for (const item of Array.isArray(summary?.questionResults) ? summary.questionResults : []) {
    const record = asRecord(item);
    if (record && typeof record.questionId === "string") {
      perQuestion.set(record.questionId, { correct: record.correct, points: record.points });
    }
  }
  const submissions = Array.isArray(response.answers) ? response.answers : [];
  return {
    Pontuação: response.totalScore,
    Percentagem: Math.round(response.percentage * 10) / 10,
    Aprovado: yesNo(response.passed),
    Perfil: response.resultProfileId ? (campaign.profiles.get(response.resultProfileId) ?? null) : null,
    "Tempo (segundos)": response.timeSeconds,
    Respostas: submissions.flatMap((item): Json[] => {
      const submission = asRecord(item);
      if (!submission || typeof submission.questionId !== "string") return [];
      const question = campaign.questions.get(submission.questionId);
      const selected = Array.isArray(submission.selectedAnswerIds) ? submission.selectedAnswerIds : [];
      const result = perQuestion.get(submission.questionId);
      return [
        {
          Pergunta: question?.title ?? "(pergunta removida do quiz)",
          "Respostas escolhidas": selected.map((answerId) =>
            typeof answerId === "string" ? (question?.answers.get(answerId) ?? "(resposta removida do quiz)") : String(answerId),
          ),
          Correta: typeof result?.correct === "boolean" ? yesNo(result.correct) : null,
          Pontos: typeof result?.points === "number" ? result.points : null,
        },
      ];
    }),
  };
}

function gameResult(participation: ExportedParticipationRow, campaign: SubjectExportCampaign): Json {
  const summary = asRecord(participation.resultSummary);
  if (campaign.type === "QUIZ") return quizResult(participation, campaign);
  if (campaign.type === "MEMORY") {
    const memory = participation.memoryResult;
    if (memory) {
      return {
        Concluído: yesNo(memory.completed),
        Pontuação: memory.score,
        "Tempo (segundos)": memory.timeSeconds,
        Tentativas: memory.attempts,
        "Pares encontrados": memory.pairsFound,
      };
    }
    return summary ? { Concluído: yesNo(summary.completed === true), Pontuação: typeof summary.score === "number" ? summary.score : null } : null;
  }
  if (!summary) return null;
  return {
    Segmento: typeof summary.segmentName === "string" ? summary.segmentName : null,
    Resultado: summary.outcome === "WIN" ? "Ganhou" : summary.outcome === "NO_WIN" ? "Não ganhou" : null,
    Mensagem: typeof summary.message === "string" ? summary.message : null,
  };
}

function prize(participation: ExportedParticipationRow, now: Date): Json {
  const award = participation.prizeAward;
  if (!award) return null;
  // As mesmas regras da lista: o código de uma reserva nunca sai.
  const shown = describePrizeAward(award, now);
  const confirmed = award.status === "CONFIRMED";
  return {
    Prémio: shown.prize || null,
    Estado: shown.prizeStatus,
    Código: shown.code || null,
    "Código válido até": confirmed ? iso(award.prizeCode?.expiresAt) : null,
    "Atribuído em": confirmed ? iso(award.confirmedAt) : null,
    Instruções: confirmed ? award.prize.instructions : null,
  };
}

/** Uma participação, com os nomes dos campos e das perguntas. */
export function exportParticipation(
  participation: ExportedParticipationRow,
  campaign: SubjectExportCampaign,
  now: Date,
): Json {
  return {
    ID: participation.id,
    Campanha: campaign.name,
    "ID da campanha": campaign.id,
    Data: iso(participation.createdAt),
    Início: iso(participation.startedAt),
    Conclusão: iso(participation.completedAt),
    Estado: PARTICIPATION_STATUS_LABELS[participation.status],
    "Participação de teste": yesNo(participation.isTest),
    Identificação: {
      Nome: participation.firstName,
      Apelido: participation.lastName,
      "E-mail": participation.email,
      Telefone: participation.phone,
    },
    "Respostas ao formulário": formAnswers(participation.leadFormResponse, campaign),
    Consentimentos: participation.consentRecords.map((record) => ({
      Texto: record.text,
      Versão: record.version,
      Resposta: CONSENT_STATUS_LABELS[record.status] ?? record.status,
      Data: iso(record.grantedAt),
      Origem: record.source,
    })),
    Resultado: gameResult(participation, campaign),
    Prémio: prize(participation, now),
    Origem: {
      Site: participation.source,
      utm_source: participation.utmSource,
      utm_medium: participation.utmMedium,
      utm_campaign: participation.utmCampaign,
      utm_content: participation.utmContent,
      utm_term: participation.utmTerm,
    },
    Dispositivo: {
      Tipo: participation.deviceType,
      Browser: participation.browser,
      "Sistema operativo": participation.os,
      "Endereço IP": participation.ipAddress,
      Sessão: participation.sessionId,
    },
    "Anonimização prevista": iso(anonymizationDate(campaign.retention, participation.createdAt)),
  };
}

function campaignSummary(campaign: SubjectExportCampaign, now: Date): Json {
  return {
    ID: campaign.id,
    Nome: campaign.name,
    Tipo: CAMPAIGN_TYPE_LABELS[campaign.type],
    "Fuso horário": campaign.timezone,
    "Política de privacidade": campaign.legalLinks.privacyPolicyUrl,
    "Termos e condições": campaign.legalLinks.termsUrl,
    "Política de cookies": campaign.legalLinks.cookiesUrl,
    "Conservação dos dados": describeRetention(campaign.retention, campaign.timezone, now),
  };
}

/** Um valor JSON com o recuo de quem o contém (o ficheiro sai legível). */
function indented(value: Json, depth: number): string {
  return JSON.stringify(value, null, 2).replace(/\n/g, `\n${"  ".repeat(depth)}`);
}

async function loadCampaigns(organizationId: string, campaignIds: string[]): Promise<Map<string, SubjectExportCampaign>> {
  if (campaignIds.length === 0) return new Map();
  const rows = await prisma.campaign.findMany({
    // Também pela organização: um id de outra nunca entra.
    where: { id: { in: campaignIds }, organizationId },
    select: {
      id: true,
      publicTitle: true,
      startTitle: true,
      internalName: true,
      type: true,
      timezone: true,
      dataRetentionDays: true,
      dataRetentionUntil: true,
      dataRetentionChangedAt: true,
      organization: { select: { dataRetentionDays: true, dataRetentionChangedAt: true } },
      theme: { select: { legalLinks: true } },
      leadForm: {
        select: { fields: { select: { internalKey: true, label: true, type: true }, orderBy: { order: "asc" } } },
      },
      quizConfig: {
        select: {
          questions: { select: { id: true, title: true, answers: { select: { id: true, text: true, order: true } } } },
          resultProfiles: { select: { id: true, title: true } },
        },
      },
    },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        // O nome que o titular viu: o título público, se houver.
        name: row.publicTitle?.trim() || row.startTitle?.trim() || row.internalName,
        type: row.type,
        timezone: row.timezone,
        legalLinks: readLegalLinks(row.theme?.legalLinks),
        retention: effectiveRetention({
          campaign: row,
          organizationDays: row.organization.dataRetentionDays,
          organizationChangedAt: row.organization.dataRetentionChangedAt,
        }),
        fields: row.leadForm?.fields ?? [],
        questions: new Map(
          (row.quizConfig?.questions ?? []).map((question) => [
            question.id,
            {
              title: question.title,
              answers: new Map(
                question.answers.map((answer) => [answer.id, answer.text?.trim() || `(resposta com imagem n.º ${answer.order + 1})`]),
              ),
            },
          ]),
        ),
        profiles: new Map((row.quizConfig?.resultProfiles ?? []).map((profile) => [profile.id, profile.title])),
      },
    ]),
  );
}

export interface SubjectExportProgress {
  /** Participações encontradas com o identificador (antes de as ler). */
  matched: number;
  /** Participações escritas no ficheiro até agora. */
  participations: number;
  campaigns: number;
  legacyParticipants: number;
}

/**
 * O ficheiro, por partes: o cabeçalho e as campanhas primeiro, depois as
 * participações por lotes (um titular com milhares de participações — um
 * endereço de testes — não fica todo em memória). `progress` diz quanto já
 * saiu, para a auditoria.
 */
export async function* subjectExportChunks(
  organizationId: string,
  subject: SubjectIdentifier,
  options: { now?: Date; progress?: SubjectExportProgress } = {},
): AsyncGenerator<string> {
  const now = options.now ?? new Date();
  const progress = options.progress ?? { matched: 0, participations: 0, campaigns: 0, legacyParticipants: 0 };

  const [organization, matches, legacy] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, privacyContactEmail: true },
    }),
    findSubjectParticipations(organizationId, subject),
    findSubjectLegacyParticipants(organizationId, subject),
  ]);
  // Por ordem cronológica: é assim que o titular as reconhece.
  matches.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const campaigns = await loadCampaigns(organizationId, [...new Set(matches.map((match) => match.campaignId))]);
  progress.matched = matches.length;
  progress.campaigns = campaigns.size;
  progress.legacyParticipants = legacy.length;

  const about: Json = {
    "Responsável pelo tratamento": organization.name,
    "Contacto de privacidade": organization.privacyContactEmail,
    "Gerada em": now.toISOString(),
    Pedido: { [subject.kind === "email" ? "E-mail" : "Telefone"]: subject.kind === "email" ? subject.email : subject.phone },
    Âmbito:
      "As participações nas campanhas desta organização com este e-mail ou telefone exatos (nos dados de identificação ou nas respostas ao formulário), em todas as campanhas e períodos, incluindo as de teste. As participações já anonimizadas deixaram de ter dados pessoais e não aparecem.",
    Datas: "Em UTC (ISO 8601). Cada campanha indica o seu fuso horário.",
    "Não incluído":
      "Estatísticas e eventos de navegação, que não guardam dados pessoais; e as chaves técnicas de acesso ao jogo (o token da participação e o cookie do browser), que serviriam para retomar a participação.",
  };

  yield `{\n  "Sobre esta exportação": ${indented(about, 1)},\n`;
  yield `  "Campanhas": ${indented([...campaigns.values()].map((campaign) => campaignSummary(campaign, now)), 1)},\n`;
  yield `  "Dados antigos de participante": ${indented(
    legacy.map((row) => ({
      Nome: row.firstName,
      Apelido: row.lastName,
      "E-mail": row.email,
      Telefone: row.phone,
      "Criado em": iso(row.createdAt),
    })),
    1,
  )},\n`;
  yield `  "Participações": [`;

  let first = true;
  for (let index = 0; index < matches.length; index += BATCH_SIZE) {
    const ids = matches.slice(index, index + BATCH_SIZE).map((match) => match.id);
    const rows = await prisma.participation.findMany({
      // Anonimizada entretanto: já não tem dados pessoais.
      where: { id: { in: ids }, anonymizedAt: null, campaign: { organizationId } },
      include: participationInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const lines: string[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      const campaign = row && campaigns.get(row.campaignId);
      if (!row || !campaign) continue;
      lines.push(`${first ? "" : ","}\n    ${indented(exportParticipation(row, campaign, now), 2)}`);
      first = false;
    }
    if (lines.length > 0) {
      yield lines.join("");
      progress.participations += lines.length;
    }
  }
  yield `${first ? "" : "\n  "}]\n}\n`;
}
