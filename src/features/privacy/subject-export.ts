import { Prisma, type AnalyticsEventType, type CampaignType, type LeadFieldType } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import {
  countMentions,
  findSubjectLegacyParticipants,
  findSubjectMentionAnswers,
  findSubjectParticipations,
  type SubjectIdentifier,
} from "@/features/leads/queries";
import { CONSENT_STATUS_LABELS, describePrizeAward } from "@/features/leads/format";
import { readLegalLinks, type LegalLinks } from "@/features/brand/legal-links";
import { publicPlayUrl } from "@/features/publishing/public-url";
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
 * Um ficheiro JSON com tudo o que a organização guarda sobre a pessoa, com
 * as chaves por esta ordem:
 * - "Sobre esta exportação" e "Os seus direitos" (texto fixo, com o
 *   contacto de privacidade e a reclamação à CNPD);
 * - "Campanhas": por campanha, o nome público e o endereço, o aviso de
 *   privacidade, os links legais e o prazo de conservação (art. 15.º, n.º 1);
 * - "Participações": as do titular (o e-mail ou o telefone nas colunas de
 *   identidade — as mesmas que o pedido de eliminação anonimiza), cada uma
 *   com a identidade, as respostas ao formulário, os consentimentos, o
 *   resultado, o prémio, a origem, o dispositivo e os eventos da sessão;
 * - "Menções noutras participações": as leads de outras pessoas com o
 *   identificador numa resposta (o e-mail de um amigo). Só o campo — nunca a
 *   identidade, as outras respostas, o IP, a sessão ou o prémio de quem o
 *   escreveu, que não são dados do titular;
 * - "Dados antigos de participante": só o identificador que coincidiu e a
 *   data (o mesmo registo antigo pode juntar várias pessoas).
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
  /** O nome que o titular viu (o da página pública), nunca o nome interno. */
  name: string;
  /** O endereço da página pública: distingue campanhas sem título. */
  publicUrl: string;
  type: CampaignType;
  timezone: string;
  /** O texto legal do ecrã inicial: o aviso de privacidade que o titular viu. */
  privacyNotice: string | null;
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

/** O nome público de uma campanha: o mesmo que a página pública mostra. */
export function publicCampaignName(campaign: { publicTitle: string | null; startTitle: string | null }): string {
  return campaign.publicTitle?.trim() || campaign.startTitle?.trim() || "Campanha";
}

/** Uma resposta em texto: um valor que não seja texto sai em JSON, e nunca fica por definir. */
function answerText(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : (JSON.stringify(value) ?? "");
}

/**
 * As respostas ao formulário com o nome de cada campo. Um campo removido
 * do formulário depois da participação fica com o identificador interno.
 * Só as chaves que a resposta tem (Object.hasOwn): com `in`, um campo
 * "constructor" apanhava o do protótipo e saía uma resposta fantasma.
 */
export function formAnswers(response: unknown, campaign: SubjectExportCampaign): Json {
  const values = asRecord(response);
  if (!values) return null;
  const known = new Set(campaign.fields.map((field) => field.internalKey));
  const answers: Json[] = [];
  const answer = (label: string, value: unknown, type?: LeadFieldType) => {
    const text = answerText(value);
    answers.push({
      Campo: label,
      Resposta: type === "CHECKBOX" || type === "TERMS_ACCEPTANCE" ? (text === "true" ? "Sim" : text === "false" ? "Não" : text) : text,
    });
  };
  for (const field of campaign.fields) {
    if (Object.hasOwn(values, field.internalKey)) answer(field.label, values[field.internalKey], field.type);
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

/** Os eventos de cada participação no ficheiro (os mais antigos primeiro). */
export const EVENTS_PER_PARTICIPATION = 200;

const EVENT_LABELS: Record<AnalyticsEventType, string> = {
  CAMPAIGN_VIEWED: "Campanha vista",
  START_CLICKED: "Clique em começar",
  LEAD_FORM_VIEWED: "Formulário visto",
  LEAD_FORM_SUBMITTED: "Formulário enviado",
  GAME_STARTED: "Jogo iniciado",
  GAME_COMPLETED: "Jogo concluído",
  GAME_ABANDONED: "Jogo abandonado",
  RESULT_VIEWED: "Resultado visto",
  CTA_CLICKED: "Clique no botão final",
  PARTICIPATION_BLOCKED: "Participação recusada",
  PRIZE_AWARDED: "Prémio atribuído",
};

/**
 * Os motivos de uma participação recusada que o jogo grava (play/actions):
 * só estes saem. Outros metadados nunca vão para o ficheiro.
 */
const BLOCKED_REASON_LABELS: Record<string, string> = {
  limit: "Limite de participações atingido",
  age_unverifiable: "Idade mínima sem verificação possível",
  honeypot: "Recusada pela proteção contra envios automáticos",
  no_eligible_segments: "Sem prémios disponíveis nesse momento",
};

export interface SubjectExportEvent {
  type: AnalyticsEventType;
  occurredAt: Date;
  metadata: unknown;
}

/** Um evento de navegação: o tipo, a data e, numa recusa, o motivo. */
export function exportEvent(event: SubjectExportEvent): Json {
  const reason = asRecord(event.metadata)?.reason;
  const label = typeof reason === "string" && Object.hasOwn(BLOCKED_REASON_LABELS, reason) ? BLOCKED_REASON_LABELS[reason] : undefined;
  return {
    Evento: EVENT_LABELS[event.type] ?? event.type,
    Data: iso(event.occurredAt),
    ...(label ? { Motivo: label } : {}),
  };
}

/** Uma participação, com os nomes dos campos e das perguntas, e os eventos da sessão. */
export function exportParticipation(
  participation: ExportedParticipationRow,
  campaign: SubjectExportCampaign,
  now: Date,
  events: readonly SubjectExportEvent[] = [],
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
    Eventos: events.map(exportEvent),
    "Anonimização prevista": iso(anonymizationDate(campaign.retention, participation.createdAt)),
  };
}

/** Uma menção: só o campo de outra lead com o identificador do titular. */
export function exportMention(
  mention: { createdAt: Date; key: string; value: string },
  campaign: SubjectExportCampaign,
): Json {
  return {
    Campanha: campaign.name,
    "ID da campanha": campaign.id,
    Data: iso(mention.createdAt),
    Campo: campaign.fields.find((field) => field.internalKey === mention.key)?.label ?? mention.key,
    Valor: mention.value,
  };
}

function campaignSummary(campaign: SubjectExportCampaign, now: Date): Json {
  return {
    ID: campaign.id,
    Nome: campaign.name,
    "Endereço público": campaign.publicUrl,
    Tipo: CAMPAIGN_TYPE_LABELS[campaign.type],
    "Fuso horário": campaign.timezone,
    "Aviso de privacidade": campaign.privacyNotice,
    "Política de privacidade": campaign.legalLinks.privacyPolicyUrl,
    "Termos e condições": campaign.legalLinks.termsUrl,
    "Política de cookies": campaign.legalLinks.cookiesUrl,
    "Conservação dos dados": describeRetention(campaign.retention, campaign.timezone, now),
  };
}

/**
 * Os direitos do titular (RGPD arts. 15.º a 22.º e 77.º), em texto fixo, e
 * como os exercer: pelo contacto de privacidade da organização, se houver.
 */
export function subjectRights(organization: { name: string; privacyContactEmail: string | null }): Json {
  const contact = organization.privacyContactEmail?.trim();
  return {
    Acesso: "Saber se a organização trata dados pessoais seus e receber uma cópia, como este ficheiro (RGPD, art. 15.º).",
    Retificação: "Pedir a correção dos dados inexatos e que os incompletos sejam completados (art. 16.º).",
    Apagamento:
      "Pedir que os seus dados sejam apagados, por exemplo quando já não forem necessários para a finalidade com que foram recolhidos ou quando retirar o consentimento (art. 17.º).",
    "Limitação do tratamento":
      "Pedir que os seus dados fiquem guardados mas sem outro uso, por exemplo enquanto se verifica se estão corretos (art. 18.º).",
    Oposição: "Opor-se ao tratamento dos seus dados e, a qualquer momento, ao uso para marketing direto (art. 21.º).",
    Portabilidade:
      "Receber os dados que forneceu num formato estruturado e de leitura automática, como este ficheiro, e transmiti-los a outra entidade (art. 20.º).",
    "Retirar o consentimento":
      "Retirar a qualquer momento um consentimento que tenha dado, por exemplo para receber novidades, sem afetar o tratamento feito antes (art. 7.º, n.º 3).",
    "Como exercer": contact
      ? `Contacte ${organization.name} pelo contacto de privacidade: ${contact}.`
      : `Contacte ${organization.name}, responsável pelo tratamento, pelos contactos indicados nas campanhas ou na política de privacidade.`,
    Reclamação:
      "Pode apresentar reclamação à Comissão Nacional de Proteção de Dados (CNPD), a autoridade de controlo em Portugal: www.cnpd.pt (art. 77.º).",
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
    // Por ordem de criação (o id desempata): a ordem do ficheiro não muda de uma exportação para a outra.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      slug: true,
      publicTitle: true,
      startTitle: true,
      legalText: true,
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
        name: publicCampaignName(row),
        publicUrl: publicPlayUrl(row.slug),
        type: row.type,
        timezone: row.timezone,
        privacyNotice: row.legalText?.trim() || null,
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

/**
 * Os eventos de navegação das participações do lote: os da mesma campanha e
 * da mesma sessão (o id que o ficheiro também leva), no máximo
 * EVENTS_PER_PARTICIPATION por participação — a sessão vem do browser, e uma
 * rajada de eventos não faz o ficheiro crescer sem limite.
 */
async function loadEvents(rows: readonly ExportedParticipationRow[]): Promise<Map<string, SubjectExportEvent[]>> {
  const sessions = [
    ...new Map(
      rows.flatMap((row) => (row.sessionId ? [[`${row.campaignId}\u0000${row.sessionId}`, row] as const] : [])),
    ).values(),
  ];
  const byKey = new Map<string, SubjectExportEvent[]>();
  if (sessions.length === 0) return byKey;
  const events = await prisma.$queryRaw<Array<SubjectExportEvent & { campaignId: string; sessionId: string }>>`
    SELECT e."campaignId", e."sessionId", e."type", e."occurredAt", e."metadata"
    FROM (
      SELECT e.*, row_number() OVER (PARTITION BY e."campaignId", e."sessionId" ORDER BY e."occurredAt", e."id") AS n
      FROM "AnalyticsEvent" e
      WHERE (e."campaignId", e."sessionId") IN (${Prisma.join(
        sessions.map((row) => Prisma.sql`(${row.campaignId}, ${row.sessionId})`),
      )})
    ) e
    WHERE e.n <= ${EVENTS_PER_PARTICIPATION}
    ORDER BY e."occurredAt", e."id"`;
  for (const event of events) {
    const key = `${event.campaignId}\u0000${event.sessionId}`;
    const list = byKey.get(key) ?? [];
    list.push({ type: event.type, occurredAt: event.occurredAt, metadata: event.metadata });
    byKey.set(key, list);
  }
  return byKey;
}

export interface SubjectExportProgress {
  /** Participações do titular (identidade) encontradas, antes de as ler. */
  matched: number;
  /** Menções (campos de outras leads) encontradas, antes de as ler. */
  mentionsMatched: number;
  /** Participações escritas no ficheiro até agora. */
  participations: number;
  /** Menções escritas no ficheiro até agora. */
  mentions: number;
  campaigns: number;
  legacyParticipants: number;
}

export function emptySubjectExportProgress(): SubjectExportProgress {
  return { matched: 0, mentionsMatched: 0, participations: 0, mentions: 0, campaigns: 0, legacyParticipants: 0 };
}

/**
 * Uma lista do ficheiro (que nunca é a última chave), por lotes: `read`
 * devolve os itens já em JSON (os que ainda existem). Um lote vazio —
 * anonimizado a meio da exportação — não parte as vírgulas.
 */
async function* jsonList(
  key: string,
  ids: readonly string[],
  read: (ids: string[]) => Promise<Json[]>,
  count: (written: number) => void,
): AsyncGenerator<string> {
  yield `  ${JSON.stringify(key)}: [`;
  let first = true;
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const items = await read(ids.slice(index, index + BATCH_SIZE));
    if (items.length === 0) continue;
    yield items.map((item, position) => `${first && position === 0 ? "" : ","}\n    ${indented(item, 2)}`).join("");
    first = false;
    count(items.length);
  }
  yield `${first ? "" : "\n  "}],\n`;
}

/**
 * O ficheiro, por partes: o cabeçalho, os direitos e as campanhas primeiro,
 * depois as participações e as menções por lotes (um titular com milhares
 * de participações — um endereço de testes — não fica todo em memória).
 * `progress` diz quanto já saiu, para a auditoria.
 */
export async function* subjectExportChunks(
  organizationId: string,
  subject: SubjectIdentifier,
  options: { now?: Date; progress?: SubjectExportProgress } = {},
): AsyncGenerator<string> {
  const now = options.now ?? new Date();
  const progress = options.progress ?? emptySubjectExportProgress();

  const [organization, matches, legacy] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, privacyContactEmail: true },
    }),
    findSubjectParticipations(organizationId, subject),
    findSubjectLegacyParticipants(organizationId, subject),
  ]);
  // Por ordem cronológica: é assim que o titular as reconhece.
  const chronological = <T extends { createdAt: Date; id: string }>(items: T[]) =>
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const identity = chronological(matches.identity);
  const mentions = chronological(matches.mentions);
  const campaigns = await loadCampaigns(organizationId, [
    ...new Set([...identity, ...mentions].map((match) => match.campaignId)),
  ]);
  progress.matched = identity.length;
  progress.mentionsMatched = countMentions(mentions);
  progress.campaigns = campaigns.size;
  progress.legacyParticipants = legacy.length;

  const identifier = subject.kind === "email" ? "E-mail" : "Telefone";
  const about: Json = {
    "Responsável pelo tratamento": organization.name,
    "Contacto de privacidade": organization.privacyContactEmail,
    "Gerada em": now.toISOString(),
    Pedido: { [identifier]: subject.kind === "email" ? subject.email : subject.phone },
    Âmbito: [
      `Em «Participações», as participações nas campanhas desta organização em que este ${identifier.toLowerCase()} é o de identificação${subject.kind === "phone" ? " (um número português com ou sem o indicativo +351)" : ""}, em todas as campanhas e períodos, incluindo as de teste, com tudo o que cada uma guarda.`,
      "Em «Menções noutras participações», os campos do formulário de outras pessoas em que este identificador aparece (por exemplo, quem o indicou como amigo): só esse campo, porque o resto dessas participações não é sobre si.",
      "Em «Dados antigos de participante», os registos antigos de um browser com este identificador: só o identificador e a data, porque o mesmo registo pode ter dados de outras pessoas que usaram o mesmo browser.",
      "As participações já anonimizadas deixaram de ter dados pessoais e não aparecem.",
    ].join(" "),
    Datas: "Em UTC (ISO 8601). Cada campanha indica o seu fuso horário.",
    "Não incluído":
      "As estatísticas agregadas, que não identificam ninguém; e as chaves técnicas de acesso ao jogo (o token da participação e o cookie do browser), que serviriam para retomar a participação. Os eventos de navegação de cada participação (quando viu a campanha, começou ou concluiu o jogo) estão em «Eventos», ligados pela sessão.",
  };

  yield `{\n  "Sobre esta exportação": ${indented(about, 1)},\n`;
  yield `  "Os seus direitos": ${indented(subjectRights(organization), 1)},\n`;
  yield `  "Campanhas": ${indented([...campaigns.values()].map((campaign) => campaignSummary(campaign, now)), 1)},\n`;

  yield* jsonList(
    "Participações",
    identity.map((match) => match.id),
    async (ids) => {
      const rows = await prisma.participation.findMany({
        // Anonimizada entretanto: já não tem dados pessoais.
        where: { id: { in: ids }, anonymizedAt: null, campaign: { organizationId } },
        include: participationInclude,
      });
      const events = await loadEvents(rows);
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(id);
        const campaign = row && campaigns.get(row.campaignId);
        if (!row || !campaign) return [];
        const sessionEvents = row.sessionId ? (events.get(`${row.campaignId}\u0000${row.sessionId}`) ?? []) : [];
        return [exportParticipation(row, campaign, now, sessionEvents)];
      });
    },
    (written) => (progress.participations += written),
  );

  yield* jsonList(
    "Menções noutras participações",
    mentions.map((mention) => mention.id),
    async (ids) => {
      // Lidas de novo, com a mesma condição: uma anonimizada entretanto, ou um campo já retirado, não sai.
      const answers = await findSubjectMentionAnswers(organizationId, subject, ids);
      return answers.flatMap((answer) => {
        const campaign = campaigns.get(answer.campaignId);
        return campaign ? [exportMention(answer, campaign)] : [];
      });
    },
    (written) => (progress.mentions += written),
  );

  yield `  "Dados antigos de participante": ${indented(
    legacy.map((row) => ({ [identifier]: row.value, "Criado em": iso(row.createdAt) })),
    1,
  )}\n}\n`;
}
