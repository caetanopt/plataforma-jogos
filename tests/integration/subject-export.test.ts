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
      leadForm: {
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
    const memory = await createCampaign(a, "MEMORY");
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

    // Quiz: o e-mail só nas respostas (um segundo campo de e-mail).
    const quiz = await createCampaign(a, "QUIZ");
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
      leadFormResponse: { outroEmail: `  ${email.toUpperCase()} ` },
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

    // Roda: prémio atribuído (com código) e outro só reservado (sem código).
    const wheel = await createCampaign(a, "WHEEL");
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

    expect(file["Sobre esta exportação"]).toMatchObject({
      "Contacto de privacidade": "privacidade@example.pt",
      Pedido: { "E-mail": email },
    });
    // As três campanhas do titular, pelo nome que ele viu.
    expect(file.Campanhas.map((campaign: { Nome: string }) => campaign.Nome).sort()).toEqual(
      [memory.campaign.publicTitle, quiz.campaign.publicTitle, wheel.campaign.publicTitle].sort(),
    );
    expect(file.Campanhas[0]["Conservação dos dados"]).toContain("365 dias");
    expect(file["Dados antigos de participante"]).toEqual([
      expect.objectContaining({ Nome: "Antiga", "E-mail": email }),
    ]);

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
    });
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
  });

  it("pelo telefone, e um titular sem participações recebe um ficheiro que o diz", async () => {
    const memory = await createCampaign(a, "MEMORY");
    const byColumn = await memory.participate({ createdAt: daysAgo(4), phone: "+351912345678" });
    const byAnswer = await memory.participate({ createdAt: daysAgo(3), leadFormResponse: { telemovel: "+351 912 345 678" } });
    await memory.participate({ createdAt: daysAgo(2), phone: "+351912345679" });

    const { text } = await exportAs(a.contexts.ORG_ADMIN, "+351 912 345 678");
    const file = JSON.parse(text);
    expect(file["Sobre esta exportação"].Pedido).toEqual({ Telefone: "+351912345678" });
    expect(file["Participações"].map((participation: { ID: string }) => participation.ID)).toEqual([byColumn.id, byAnswer.id]);

    const none = await exportAs(a.contexts.ORG_ADMIN, "ninguem@example.pt");
    expect(none.response.status).toBe(200);
    expect(none.response.headers.get("x-subject-participations")).toBe("0");
    expect(JSON.parse(none.text)).toMatchObject({ Campanhas: [], "Dados antigos de participante": [], "Participações": [] });
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
