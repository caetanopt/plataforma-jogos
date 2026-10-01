import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { CampaignType, MembershipRole, Prisma } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Exportação dos dados de um titular (§24, RGPD art. 15.º): o que sai, o
 * que nunca sai, de quem é e quem a pode pedir, contra a base de dados.
 * Substitui-se só a sessão.
 */

const state = vi.hoisted(() => ({ current: null as OrgContext | null }));
vi.mock("@/server/auth/session", () => ({
  resolveOrgContext: async () =>
    state.current ? { ok: true, context: state.current } : { ok: false, reason: "no_session" },
  requireOrgContext: async () => {
    if (!state.current) throw new Error("Sem sessão de teste.");
    return state.current;
  },
}));
vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const route = await import("@/app/api/privacy/subject-export/route");
const { subjectExportChunks } = await import("@/features/privacy/subject-export");
const { anonymizeParticipationsByIds } = await import("@/features/privacy/anonymize");

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type Role = "ORG_ADMIN" | "EDITOR" | "ANALYST";
interface Org {
  id: string;
  contexts: Record<Role, OrgContext>;
  userId: string;
  workspaceId: string;
}

const orgIds: string[] = [];
const userIds: string[] = [];

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Exp ${suffix}`, slug: `exp-${suffix}`, privacyContactEmail: "privacidade@example.pt", dataRetentionDays: 365 },
  });
  orgIds.push(organization.id);
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `exp-${suffix}` },
  });
  const contexts = {} as Org["contexts"];
  for (const role of ["ORG_ADMIN", "EDITOR", "ANALYST"] as MembershipRole[]) {
    const user = await prisma.user.create({
      data: { name: role, email: `exp-${role.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
    });
    userIds.push(user.id);
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role, canExportLeads: true },
    });
    contexts[role as Role] = {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      isSuperAdmin: false,
      organizationId: organization.id,
      membership,
    };
  }
  return { id: organization.id, contexts, userId: contexts.ORG_ADMIN.userId, workspaceId: workspace.id };
}

async function createCampaign(org: Org, type: CampaignType, extra: Partial<Prisma.CampaignUncheckedCreateInput> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      workspaceId: org.workspaceId,
      type,
      internalName: `Interno ${suffix}`,
      publicTitle: `Campanha ${suffix}`,
      ownerId: org.userId,
      slug: `exp-${suffix}`,
      status: "PUBLISHED",
      ...extra,
      leadForm: extra.leadForm ?? {
        create: {
          position: "BEFORE_GAME",
          fields: {
            create: [
              { type: "FIRST_NAME", internalKey: "nome", label: "O seu nome", order: 0 },
              { type: "EMAIL", internalKey: "email", label: "O seu e-mail", order: 1 },
              { type: "CHECKBOX", internalKey: "socio", label: "É sócio?", order: 2 },
            ],
          },
          consentDefinitions: { create: [{ text: "Aceito receber novidades", isMarketing: true, order: 0 }] },
        },
      },
    },
    include: { leadForm: { include: { consentDefinitions: true } } },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: org.userId },
  });

  const participate = async (data: Partial<Prisma.ParticipationUncheckedCreateInput> & { createdAt: Date }) => {
    const participation = await prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        idempotencyKey: `token-${randomUUID()}`,
        status: "COMPLETED",
        startedAt: data.createdAt,
        ...data,
      },
    });
    return participation;
  };
  return { campaign, version, participate };
}

function exportRequest(subject: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example/api/privacy/subject-export", {
    method: "POST",
    headers: { host: "app.example", origin: "https://app.example", "content-type": "application/json", ...headers },
    body: JSON.stringify({ subject }),
  });
}

async function exportAs(context: OrgContext, subject: unknown) {
  state.current = context;
  const response = await route.POST(exportRequest(subject));
  return { response, text: response.ok ? await response.text() : "" };
}

let a: Org;
let b: Org;

beforeEach(async () => {
  a = await createOrg("a");
  b = await createOrg("b");
});

afterEach(async () => {
  state.current = null;
  const where = { organizationId: { in: orgIds } };
  await prisma.participation.deleteMany({ where: { campaign: where } });
  await prisma.participant.deleteMany({ where });
  await prisma.campaignVersion.deleteMany({ where: { campaign: where } });
  await prisma.campaign.deleteMany({ where });
  await prisma.auditLog.deleteMany({ where });
  await prisma.membership.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.workspace.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  orgIds.length = 0;
  userIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("exportação dos dados de um titular", () => {
  it("leva todas as participações do titular, de todas as campanhas, com os nomes dos campos e das perguntas", { timeout: 30_000 }, async () => {
    const email = `titular-${randomUUID().slice(0, 6)}@example.pt`;

    // Memória: identidade nas colunas, formulário, consentimento e o resultado.
    const memory = await createCampaign(a, "MEMORY", { legalText: "Os seus dados servem para o sorteio." });
    const participant = await prisma.participant.create({
      data: { organizationId: a.id, cookieId: `cookie-${randomUUID()}`, email, firstName: "Antiga" },
    });
    const first = await memory.participate({
      createdAt: daysAgo(30),
      participantId: participant.id,
      email,
      phone: "912345678",
      firstName: "Ana",
      lastName: "Silva",
      leadFormResponse: { nome: "Ana", email, socio: "true", campoRemovido: "valor antigo" },
      resultSummary: { completed: true, score: 80 },
      ipAddress: "203.0.113.7",
      sessionId: "sessao-1",
      source: "news.example",
      utmSource: "newsletter",
      utmContent: "subscriber-123",
      deviceType: "mobile",
      browser: "Safari",
      os: "iOS",
    });
    await prisma.memoryResult.create({
      data: { participationId: first.id, timeSeconds: 42, attempts: 9, pairsFound: 6, score: 80, completed: true },
    });
    await prisma.consentRecord.create({
      data: {
        participationId: first.id,
        consentDefinitionId: memory.campaign.leadForm!.consentDefinitions[0]!.id,
        status: "GRANTED",
        text: "Aceito receber novidades",
        version: 1,
        source: `play:${memory.campaign.slug}`,
      },
    });

    // Quiz: sem título público, com o título do ecrã inicial.
    const quiz = await createCampaign(a, "QUIZ", { publicTitle: null, startTitle: "Teste os seus conhecimentos" });
    const config = await prisma.quizConfig.create({
      data: {
        campaignId: quiz.campaign.id,
        questions: {
          create: [
            {
              order: 0,
              type: "SINGLE_CHOICE",
              title: "Qual é a capital?",
              answers: { create: [{ order: 0, text: "Lisboa", isCorrect: true }, { order: 1, text: "Porto" }] },
            },
          ],
        },
        resultProfiles: { create: [{ minPercentage: 0, maxPercentage: 100, title: "Explorador" }] },
      },
      include: { questions: { include: { answers: true } }, resultProfiles: true },
    });
    const question = config.questions[0]!;
    const lisboa = question.answers.find((answer) => answer.text === "Lisboa")!;
    const second = await quiz.participate({
      createdAt: daysAgo(10),
      email,
      leadFormResponse: { email: `  ${email.toUpperCase()} ` },
      resultSummary: { questionResults: [{ questionId: question.id, correct: true, points: 10 }], totalScore: 10 },
    });
    await prisma.quizResponse.create({
      data: {
        participationId: second.id,
        answers: [
          { questionId: question.id, selectedAnswerIds: [lisboa.id] },
          { questionId: "pergunta-apagada", selectedAnswerIds: ["x"] },
        ],
        totalScore: 10,
        percentage: 100,
        passed: true,
        resultProfileId: config.resultProfiles[0]!.id,
        timeSeconds: 12,
      },
    });

    // Os eventos da sessão da primeira: só os da mesma campanha e sessão, e
    // dos metadados só o motivo de uma recusa.
    await prisma.analyticsEvent.createMany({
      data: [
        { campaignId: memory.campaign.id, sessionId: "sessao-1", type: "CAMPAIGN_VIEWED", occurredAt: new Date(first.createdAt.getTime() - 5_000) },
        { campaignId: memory.campaign.id, sessionId: "sessao-1", type: "GAME_COMPLETED", occurredAt: new Date(first.createdAt.getTime() + 60_000) },
        {
          campaignId: memory.campaign.id,
          sessionId: "sessao-1",
          type: "PARTICIPATION_BLOCKED",
          occurredAt: new Date(first.createdAt.getTime() + 120_000),
          metadata: { reason: "limit", detalhe: "segredo-interno" },
        },
        { campaignId: memory.campaign.id, sessionId: "sessao-de-outro", type: "GAME_STARTED", occurredAt: first.createdAt },
      ],
    });

    // Roda: sem título nenhum ("Campanha", como na página pública).
    const wheel = await createCampaign(a, "WHEEL", { publicTitle: null });
    const prize = await prisma.prize.create({
      data: { campaignId: wheel.campaign.id, internalName: "Vale", publicName: "Vale 10 €", instructions: "Mostre na loja." },
    });
    const [won, reserved] = await Promise.all([
      prisma.prizeCode.create({ data: { prizeId: prize.id, code: "GANHO-1", status: "ASSIGNED" } }),
      prisma.prizeCode.create({ data: { prizeId: prize.id, code: "RESERVA-1", status: "RESERVED" } }),
    ]);
    const third = await wheel.participate({
      createdAt: daysAgo(5),
      email,
      resultSummary: { segmentId: "s", segmentName: "Vale", outcome: "WIN", message: "Parabéns!", prize: null },
    });
    await prisma.prizeAward.create({
      data: { participationId: third.id, prizeId: prize.id, prizeCodeId: won.id, status: "CONFIRMED", confirmedAt: daysAgo(5) },
    });
    const fourth = await wheel.participate({ createdAt: daysAgo(1), email, isTest: true });
    await prisma.prizeAward.create({
      data: {
        participationId: fourth.id,
        prizeId: prize.id,
        prizeCodeId: reserved.id,
        status: "RESERVED",
        reservationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    // Não são do titular: outra pessoa, um e-mail parecido, outra
    // organização, e uma participação já anonimizada.
    await memory.participate({ createdAt: daysAgo(3), email: "outra@example.pt", leadFormResponse: { email: "outra@example.pt" } });
    await memory.participate({ createdAt: daysAgo(3), email: `x${email}` });
    const foreign = await createCampaign(b, "MEMORY");
    await foreign.participate({ createdAt: daysAgo(3), email });
    const gone = await memory.participate({ createdAt: daysAgo(2), email });
    await anonymizeParticipationsByIds(a.id, [gone.id], new Date());

    const { response, text } = await exportAs(a.contexts.ORG_ADMIN, email.toUpperCase());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="dados-titular-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const file = JSON.parse(text);

    expect(Object.keys(file)).toEqual([
      "Sobre esta exportação",
      "Os seus direitos",
      "Campanhas",
      "Participações",
      "Menções noutras participações",
      "Dados antigos de participante",
    ]);
    expect(file["Sobre esta exportação"]).toMatchObject({
      "Contacto de privacidade": "privacidade@example.pt",
      Pedido: { "E-mail": email },
    });
    expect(file["Os seus direitos"]).toMatchObject({
      Acesso: expect.any(String),
      Retificação: expect.any(String),
      Apagamento: expect.any(String),
      "Limitação do tratamento": expect.any(String),
      Oposição: expect.any(String),
      Portabilidade: expect.any(String),
      "Como exercer": expect.stringContaining("privacidade@example.pt"),
      Reclamação: expect.stringContaining("www.cnpd.pt"),
    });
    // As três campanhas do titular, pelo nome que ele viu e com o endereço
    // público (distingue as que não têm título); nunca o nome interno.
    const byId = new Map(file.Campanhas.map((campaign: { ID: string }) => [campaign.ID, campaign]));
    expect(byId.get(memory.campaign.id)).toMatchObject({
      Nome: memory.campaign.publicTitle,
      "Endereço público": expect.stringMatching(new RegExp(`/play/${memory.campaign.slug}$`)),
      "Aviso de privacidade": "Os seus dados servem para o sorteio.",
      "Conservação dos dados": expect.stringContaining("365 dias"),
    });
    expect(byId.get(quiz.campaign.id)).toMatchObject({ Nome: "Teste os seus conhecimentos", "Aviso de privacidade": null });
    expect(byId.get(wheel.campaign.id)).toMatchObject({
      Nome: "Campanha",
      "Endereço público": expect.stringMatching(new RegExp(`/play/${wheel.campaign.slug}$`)),
    });
    for (const created of [memory, quiz, wheel]) expect(text).not.toContain(created.campaign.internalName);
    // Do registo antigo, só o identificador que coincidiu e a data.
    expect(file["Dados antigos de participante"]).toEqual([{ "E-mail": email, "Criado em": participant.createdAt.toISOString() }]);
    expect(text).not.toContain("Antiga");
    expect(file["Menções noutras participações"]).toEqual([]);

    // Por ordem cronológica, só as quatro do titular.
    const ids = file["Participações"].map((participation: { ID: string }) => participation.ID);
    expect(ids).toEqual([first.id, second.id, third.id, fourth.id]);
    const [m, q, w, t] = file["Participações"];

    expect(m).toMatchObject({
      Campanha: memory.campaign.publicTitle,
      Estado: "Concluída",
      "Participação de teste": "Não",
      Identificação: { Nome: "Ana", Apelido: "Silva", "E-mail": email, Telefone: "912345678" },
      "Respostas ao formulário": [
        { Campo: "O seu nome", Resposta: "Ana" },
        { Campo: "O seu e-mail", Resposta: email },
        { Campo: "É sócio?", Resposta: "Sim" },
        // Um campo que já não existe no formulário fica com o identificador.
        { Campo: "campoRemovido", Resposta: "valor antigo" },
      ],
      Consentimentos: [
        expect.objectContaining({ Texto: "Aceito receber novidades", Versão: 1, Resposta: "Aceite", Origem: `play:${memory.campaign.slug}` }),
      ],
      Resultado: { Concluído: "Sim", Pontuação: 80, "Tempo (segundos)": 42, Tentativas: 9, "Pares encontrados": 6 },
      Prémio: null,
      Origem: { Site: "news.example", utm_source: "newsletter", utm_content: "subscriber-123" },
      Dispositivo: { Tipo: "mobile", Browser: "Safari", "Sistema operativo": "iOS", "Endereço IP": "203.0.113.7", Sessão: "sessao-1" },
      Eventos: [
        { Evento: "Campanha vista", Data: new Date(first.createdAt.getTime() - 5_000).toISOString() },
        { Evento: "Jogo concluído", Data: new Date(first.createdAt.getTime() + 60_000).toISOString() },
        {
          Evento: "Participação recusada",
          Data: new Date(first.createdAt.getTime() + 120_000).toISOString(),
          Motivo: "Limite de participações atingido",
        },
      ],
    });
    expect(text).not.toContain("segredo-interno");
    expect(q.Campanha).toBe("Teste os seus conhecimentos");
    expect(q.Eventos).toEqual([]);
    // Organização com 365 dias: a data em que os dados saem.
    expect(new Date(m["Anonimização prevista"]).getTime()).toBe(first.createdAt.getTime() + 365 * DAY);

    expect(q.Resultado).toEqual({
      Pontuação: 10,
      Percentagem: 100,
      Aprovado: "Sim",
      Perfil: "Explorador",
      "Tempo (segundos)": 12,
      Respostas: [
        { Pergunta: "Qual é a capital?", "Respostas escolhidas": ["Lisboa"], Correta: "Sim", Pontos: 10 },
        { Pergunta: "(pergunta removida do quiz)", "Respostas escolhidas": ["(resposta removida do quiz)"], Correta: null, Pontos: null },
      ],
    });

    expect(w.Resultado).toEqual({ Segmento: "Vale", Resultado: "Ganhou", Mensagem: "Parabéns!" });
    expect(w["Prémio"]).toMatchObject({ Prémio: "Vale 10 €", Estado: "Atribuído", Código: "GANHO-1", Instruções: "Mostre na loja." });
    // Uma reserva: o código pode vir a ser de outra pessoa.
    expect(t["Participação de teste"]).toBe("Sim");
    expect(t["Prémio"]).toMatchObject({ Prémio: null, Código: null, Estado: "Reservado (a aguardar a lead)" });
    expect(text).not.toContain("RESERVA-1");

    // Nunca as chaves de acesso ao jogo, nem dados de outras pessoas.
    for (const participation of [first, second, third, fourth]) expect(text).not.toContain(participation.idempotencyKey);
    expect(text).not.toContain(participant.cookieId!);
    expect(text).not.toContain("outra@example.pt");
    expect(text).not.toContain(`x${email}`);
    expect(text).not.toContain(gone.id);

    expect(response.headers.get("x-subject-participations")).toBe("4");
    expect(response.headers.get("x-subject-mentions")).toBe("0");
    expect(response.headers.get("x-subject-legacy")).toBe("1");
  });

  it("pelo telefone escrito de qualquer forma, nas colunas e noutro campo do formulário", { timeout: 30_000 }, async () => {
    const memory = await createCampaign(a, "MEMORY", {
      leadForm: {
        create: {
          position: "BEFORE_GAME",
          fields: {
            create: [
              { type: "PHONE", internalKey: "telefone", label: "O seu telefone", order: 0 },
              { type: "PHONE", internalKey: "outroTelefone", label: "Telefone alternativo", order: 1 },
            ],
          },
        },
      },
    });
    // As do titular: gravadas como normalizePhone as deixa ("912 345 678" e "00351…").
    const national = await memory.participate({ createdAt: daysAgo(5), phone: "912345678", leadFormResponse: { telefone: "912 345 678" } });
    const international = await memory.participate({
      createdAt: daysAgo(4),
      phone: "+351912345678",
      leadFormResponse: { telefone: "00351912345678" },
    });
    // De outras pessoas, com o número do titular no segundo campo.
    const other = await memory.participate({
      createdAt: daysAgo(3),
      phone: "+351961111111",
      firstName: "Rui",
      ipAddress: "198.51.100.4",
      leadFormResponse: { telefone: "+351 961 111 111", outroTelefone: "+351 912 345 678" },
    });
    const dashed = await memory.participate({ createdAt: daysAgo(2), phone: "961222222", leadFormResponse: { outroTelefone: "912-345-678" } });
    // Não são do titular: outro número, outro país, e o número no meio de um texto comprido.
    await memory.participate({ createdAt: daysAgo(1), phone: "+351912345679" });
    await memory.participate({ createdAt: daysAgo(1), phone: "+44912345678" });
    await memory.participate({
      createdAt: daysAgo(1),
      phone: "961333333",
      leadFormResponse: { comentario: `Liguem-me para o 912 345 678 ou para outro número qualquer, por favor ${"x".repeat(40)}` },
    });

    for (const request of ["912345678", "912 345 678", "+351 912 345 678", "00351912345678"]) {
      const { response, text } = await exportAs(a.contexts.ORG_ADMIN, request);
      const file = JSON.parse(text);
      expect(file["Participações"].map((participation: { ID: string }) => participation.ID), request).toEqual([
        national.id,
        international.id,
      ]);
      expect(file["Menções noutras participações"], request).toEqual([
        {
          Campanha: memory.campaign.publicTitle,
          "ID da campanha": memory.campaign.id,
          Data: other.createdAt.toISOString(),
          Campo: "Telefone alternativo",
          Valor: "+351 912 345 678",
        },
        {
          Campanha: memory.campaign.publicTitle,
          "ID da campanha": memory.campaign.id,
          Data: dashed.createdAt.toISOString(),
          Campo: "Telefone alternativo",
          Valor: "912-345-678",
        },
      ]);
      // Nada mais das participações de outras pessoas.
      for (const foreign of [other.id, dashed.id, "961 111 111", "+351961111111", "961222222", "Rui", "198.51.100.4"]) {
        expect(text).not.toContain(foreign);
      }
      expect(response.headers.get("x-subject-participations")).toBe("2");
      expect(response.headers.get("x-subject-mentions")).toBe("2");
    }
  });

  it("o e-mail de um amigo e um campo oculto: só o campo, e nada da outra pessoa", { timeout: 30_000 }, async () => {
    const wheel = await createCampaign(a, "WHEEL", {
      leadForm: {
        create: {
          position: "BEFORE_GAME",
          fields: {
            create: [
              { type: "FIRST_NAME", internalKey: "nome", label: "O seu nome", order: 0 },
              { type: "EMAIL", internalKey: "email", label: "O seu e-mail", order: 1 },
              { type: "EMAIL", internalKey: "amigo", label: "E-mail de um amigo", order: 2 },
              // O servidor preenche-o com o mesmo valor em todas as leads.
              { type: "HIDDEN", internalKey: "concessionario", label: "Concessionário", order: 3, defaultValue: "loja@example.pt" },
            ],
          },
          consentDefinitions: { create: [{ text: "Novidades", isMarketing: true, order: 0 }] },
        },
      },
    });
    const prize = await prisma.prize.create({ data: { campaignId: wheel.campaign.id, internalName: "Vale", publicName: "Vale 10 €" } });
    const code = await prisma.prizeCode.create({ data: { prizeId: prize.id, code: "JOANA-1", status: "ASSIGNED" } });
    const own = await wheel.participate({
      createdAt: daysAgo(3),
      email: "ana@example.pt",
      firstName: "Ana",
      leadFormResponse: { nome: "Ana", email: "ana@example.pt", concessionario: "loja@example.pt" },
    });
    // A Joana indicou a Ana como amiga: a lead é da Joana.
    const friend = await wheel.participate({
      createdAt: daysAgo(2),
      email: "joana@example.pt",
      firstName: "Joana",
      ipAddress: "198.51.100.9",
      sessionId: "sessao-joana",
      utmContent: "subscriber-joana",
      leadFormResponse: { nome: "Joana", email: "joana@example.pt", amigo: " Ana@Example.pt ", concessionario: "loja@example.pt" },
      resultSummary: { segmentName: "Vale", outcome: "WIN", message: "Parabéns, Joana!" },
    });
    await prisma.prizeAward.create({
      data: { participationId: friend.id, prizeId: prize.id, prizeCodeId: code.id, status: "CONFIRMED", confirmedAt: daysAgo(2) },
    });
    await prisma.consentRecord.create({
      data: {
        participationId: friend.id,
        consentDefinitionId: wheel.campaign.leadForm!.consentDefinitions[0]!.id,
        status: "GRANTED",
        text: "Novidades",
        version: 1,
      },
    });

    const { response, text } = await exportAs(a.contexts.ORG_ADMIN, "ana@example.pt");
    const file = JSON.parse(text);
    expect(file["Participações"].map((participation: { ID: string }) => participation.ID)).toEqual([own.id]);
    expect(file["Menções noutras participações"]).toEqual([
      {
        Campanha: wheel.campaign.publicTitle,
        "ID da campanha": wheel.campaign.id,
        Data: friend.createdAt.toISOString(),
        Campo: "E-mail de um amigo",
        Valor: " Ana@Example.pt ",
      },
    ]);
    for (const foreign of [friend.id, "joana@example.pt", "Joana", "198.51.100.9", "sessao-joana", "subscriber-joana", "JOANA-1"]) {
      expect(text).not.toContain(foreign);
    }
    expect(response.headers.get("x-subject-participations")).toBe("1");
    expect(response.headers.get("x-subject-mentions")).toBe("1");

    // O valor do campo oculto não é de ninguém: não traz nenhuma lead.
    const hidden = await exportAs(a.contexts.ORG_ADMIN, "loja@example.pt");
    const hiddenFile = JSON.parse(hidden.text);
    expect(hiddenFile["Participações"]).toEqual([]);
    expect(hiddenFile["Menções noutras participações"]).toEqual([]);
    expect(hiddenFile.Campanhas).toEqual([]);
    expect(hidden.response.headers.get("x-subject-mentions")).toBe("0");
  });

  it("registos antigos de um quiosque: só o identificador que coincidiu, nos dois sentidos", async () => {
    // O código antigo deixava num registo os valores da pessoa anterior nos campos que a seguinte não preenchia.
    const kiosk = await prisma.participant.create({
      data: {
        organizationId: a.id,
        cookieId: `quiosque-${randomUUID()}`,
        email: "ana@example.pt",
        phone: "+351 961 111 111",
        firstName: "Rui",
        lastName: "Costa",
      },
    });
    const byEmail = JSON.parse((await exportAs(a.contexts.ORG_ADMIN, "ana@example.pt")).text);
    expect(byEmail["Dados antigos de participante"]).toEqual([{ "E-mail": "ana@example.pt", "Criado em": kiosk.createdAt.toISOString() }]);

    const { response, text } = await exportAs(a.contexts.ORG_ADMIN, "961111111");
    const byPhone = JSON.parse(text);
    expect(byPhone["Dados antigos de participante"]).toEqual([{ Telefone: "+351 961 111 111", "Criado em": kiosk.createdAt.toISOString() }]);
    for (const other of ["ana@example.pt", "Rui", "Costa"]) expect(text).not.toContain(other);
    expect(response.headers.get("x-subject-legacy")).toBe("1");
  });

  it("um titular sem participações recebe um ficheiro que o diz", async () => {
    const none = await exportAs(a.contexts.ORG_ADMIN, "ninguem@example.pt");
    expect(none.response.status).toBe(200);
    expect(none.response.headers.get("x-subject-participations")).toBe("0");
    expect(none.response.headers.get("x-subject-mentions")).toBe("0");
    expect(none.response.headers.get("x-subject-legacy")).toBe("0");
    expect(JSON.parse(none.text)).toMatchObject({
      Campanhas: [],
      "Participações": [],
      "Menções noutras participações": [],
      "Dados antigos de participante": [],
    });
  });

  it("lê por lotes sem partir o JSON", async () => {
    const memory = await createCampaign(a, "MEMORY");
    const email = "muitas@example.pt";
    const base = Date.now() - 400 * 60_000;
    await prisma.participation.createMany({
      data: Array.from({ length: 205 }, (_, index) => ({
        campaignId: memory.campaign.id,
        campaignVersionId: memory.version.id,
        idempotencyKey: `token-${randomUUID()}`,
        status: "COMPLETED" as const,
        email,
        createdAt: new Date(base + index * 60_000),
      })),
    });
    const { text } = await exportAs(a.contexts.ORG_ADMIN, email);
    const participations = JSON.parse(text)["Participações"];
    expect(participations).toHaveLength(205);
    expect(new Set(participations.map((participation: { ID: string }) => participation.ID)).size).toBe(205);
  });

  it("uma participação anonimizada a meio da exportação já não sai", async () => {
    const memory = await createCampaign(a, "MEMORY");
    const email = "meio@example.pt";
    const kept = await memory.participate({ createdAt: daysAgo(3), email });
    const removed = await memory.participate({ createdAt: daysAgo(2), email, firstName: "NomeQueSai" });

    const chunks = subjectExportChunks(a.id, { kind: "email", email });
    let text = (await chunks.next()).value as string;
    // As procuras já foram feitas; a anonimização chega antes de as ler.
    await anonymizeParticipationsByIds(a.id, [removed.id], new Date());
    for await (const chunk of chunks) text += chunk;

    const file = JSON.parse(text);
    expect(file["Participações"].map((participation: { ID: string }) => participation.ID)).toEqual([kept.id]);
    expect(text).not.toContain("NomeQueSai");
  });

  it("um lote inteiro anonimizado a meio da exportação: o JSON continua válido", { timeout: 30_000 }, async () => {
    const memory = await createCampaign(a, "MEMORY");
    const email = "lote@example.pt";
    const base = Date.now() - 400 * 60_000;
    await prisma.participation.createMany({
      data: Array.from({ length: 150 }, (_, index) => ({
        campaignId: memory.campaign.id,
        campaignVersionId: memory.version.id,
        idempotencyKey: `token-${randomUUID()}`,
        status: "COMPLETED" as const,
        email,
        createdAt: new Date(base + index * 60_000),
      })),
    });
    const mention = await memory.participate({ createdAt: daysAgo(1), email: "outra@example.pt", leadFormResponse: { amigo: email } });
    const ids = (
      await prisma.participation.findMany({ where: { campaignId: memory.campaign.id, email }, orderBy: { createdAt: "asc" }, select: { id: true } })
    ).map((row) => row.id);

    state.current = a.contexts.ORG_ADMIN;
    const response = await route.POST(exportRequest(email));
    expect(response.headers.get("x-subject-participations")).toBe("150");
    expect(response.headers.get("x-subject-mentions")).toBe("1");
    // As procuras já foram feitas: sai o primeiro lote inteiro (100) e a menção.
    await anonymizeParticipationsByIds(a.id, [...ids.slice(0, 100), mention.id], new Date());
    const file = JSON.parse(await response.text());

    expect(file["Participações"].map((participation: { ID: string }) => participation.ID)).toEqual(ids.slice(100));
    expect(file["Menções noutras participações"]).toEqual([]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: a.id, action: "EXPORT", metadata: { path: ["stage"], equals: "completed" } },
    });
    expect(audit.metadata).toMatchObject({ matched: 150, participations: 50, mentionsMatched: 1, mentions: 0 });
  });

  it("um lote em que todas as menções já saíram também não parte o JSON", async () => {
    const memory = await createCampaign(a, "MEMORY");
    const email = "mencoes@example.pt";
    const own = await memory.participate({ createdAt: daysAgo(3), email });
    const mention = await memory.participate({ createdAt: daysAgo(2), email: "outra@example.pt", leadFormResponse: { amigo: email } });

    const chunks = subjectExportChunks(a.id, { kind: "email", email });
    let text = (await chunks.next()).value as string;
    // Retirado o campo (anonimização do titular) antes de as menções serem lidas.
    await prisma.participation.update({ where: { id: mention.id }, data: { leadFormResponse: {} } });
    for await (const chunk of chunks) text += chunk;

    const file = JSON.parse(text);
    expect(file["Participações"].map((participation: { ID: string }) => participation.ID)).toEqual([own.id]);
    expect(file["Menções noutras participações"]).toEqual([]);
  });

  describe("ciclo de vida da transferência", () => {
    async function seed(email: string, count = 3) {
      const memory = await createCampaign(a, "MEMORY");
      for (let index = 0; index < count; index += 1) await memory.participate({ createdAt: daysAgo(count - index), email });
      state.current = a.contexts.ORG_ADMIN;
    }

    const stages = async () =>
      (await prisma.auditLog.findMany({ where: { organizationId: a.id, action: "EXPORT" }, orderBy: { createdAt: "asc" } })).map(
        (entry) => {
          const metadata = entry.metadata as { stage?: string; reason?: string };
          return [entry.result, metadata.stage, metadata.reason ?? null];
        },
      );

    it("cancelada depois do primeiro bloco: um registo de falha, e nenhum erro no log", async () => {
      await seed("cancelada@example.pt");
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const response = await route.POST(exportRequest("cancelada@example.pt"));
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        await vi.waitFor(async () => expect((await stages()).length).toBe(2));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await stages()).toEqual([
          ["SUCCESS", "started", null],
          ["FAILURE", "interrupted", "cancelled"],
        ]);
        expect(errors).not.toHaveBeenCalled();
      } finally {
        errors.mockRestore();
      }
    });

    it("uma leitura que falha a meio: o download dá erro e a auditoria regista a falha", async () => {
      await seed("falha@example.pt");
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const findMany = vi.spyOn(prisma.participation, "findMany").mockRejectedValueOnce(new Error("base de dados em baixo"));
      try {
        const response = await route.POST(exportRequest("falha@example.pt"));
        expect(response.status).toBe(200);
        await expect(response.text()).rejects.toThrow();
        expect(await stages()).toEqual([
          ["SUCCESS", "started", null],
          ["FAILURE", "interrupted", "error"],
        ]);
        // Só o nome do erro no log, nunca o identificador.
        expect(JSON.stringify(errors.mock.calls)).not.toContain("falha@example.pt");
      } finally {
        findMany.mockRestore();
        errors.mockRestore();
      }
    });

    it("uma falha antes do primeiro byte: 500 em JSON, e a auditoria regista a falha", async () => {
      await seed("antes@example.pt");
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const findOrganization = vi
        .spyOn(prisma.organization, "findUniqueOrThrow")
        .mockRejectedValueOnce(new Error("base de dados em baixo"));
      try {
        const response = await route.POST(exportRequest("antes@example.pt"));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "A exportação falhou. Tente de novo." });
        expect(await stages()).toEqual([
          ["SUCCESS", "started", null],
          ["FAILURE", "interrupted", "error"],
        ]);
        expect(JSON.stringify(errors.mock.calls)).not.toContain("antes@example.pt");
      } finally {
        findOrganization.mockRestore();
        errors.mockRestore();
      }
    });
  });

  it("só para administradores, da própria página, e sem o identificador na auditoria", async () => {
    const email = "auditoria@example.pt";
    const memory = await createCampaign(a, "MEMORY");
    await memory.participate({ createdAt: daysAgo(1), email });

    for (const role of ["EDITOR", "ANALYST"] as const) {
      const { response } = await exportAs(a.contexts[role], email);
      expect(response.status).toBe(403);
    }
    state.current = null;
    expect((await route.POST(exportRequest(email))).status).toBe(401);

    state.current = a.contexts.ORG_ADMIN;
    // Outro site, sem Origin, ou um formulário (não JSON): recusado.
    expect((await route.POST(exportRequest(email, { origin: "https://evil.example" }))).status).toBe(403);
    const noOrigin = exportRequest(email);
    noOrigin.headers.delete("origin");
    expect((await route.POST(noOrigin)).status).toBe(403);
    expect((await route.POST(exportRequest(email, { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    for (const invalid of ["", "ana", "12345", 42]) {
      const response = await route.POST(exportRequest(invalid));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Indique o e-mail ou o telefone completo do titular." });
    }

    const { response } = await exportAs(a.contexts.ORG_ADMIN, email);
    expect(response.status).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId: a.id, action: "EXPORT" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((entry) => [entry.result, (entry.metadata as { stage?: string; reason?: string }).stage ?? (entry.metadata as { reason?: string }).reason])).toEqual([
      ["FAILURE", "forbidden"],
      ["FAILURE", "forbidden"],
      ["SUCCESS", "started"],
      ["SUCCESS", "completed"],
    ]);
    expect(audits.at(-1)!.metadata).toMatchObject({
      scope: "subject",
      identifierKind: "email",
      matched: 1,
      participations: 1,
      campaigns: 1,
    });
    expect(audits.at(-1)!.userId).toBe(a.contexts.ORG_ADMIN.userId);
    expect(JSON.stringify(audits)).not.toContain(email);
  });
});
