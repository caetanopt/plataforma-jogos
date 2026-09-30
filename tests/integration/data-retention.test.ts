import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { MembershipRole, Prisma } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Conservação e anonimização dos dados (§24): o prazo, a tarefa diária, a
 * anonimização manual, os avisos e a rota do cron, contra a base de dados.
 * Substitui-se só a sessão e o cache do Next.
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

const { IDLE } = await import("@/lib/forms/action-result");
const { runDataRetention, RETENTION_RUN_ENTITY, lastRetentionRun } = await import("@/features/privacy/retention-job");
const { anonymizeCampaignBefore, anonymizeParticipationsByIds } = await import("@/features/privacy/anonymize");
const { anonymizeLeadsAction, updateCampaignRetentionAction, updateOrganizationRetentionAction } = await import(
  "@/features/privacy/actions"
);
const { retentionOutlook, retentionJobStatus } = await import("@/features/privacy/retention-queries");
const { getCampaignStats } = await import("@/features/analytics/campaign-stats");
const { listLeads } = await import("@/features/leads/queries");
const { resolveDateRange } = await import("@/lib/dates/range");
const cronRoute = await import("@/app/api/cron/retention/route");

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
const testStartedAt = new Date();

async function createOrg(label: string, dataRetentionDays: number | null = null): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Ret ${suffix}`, slug: `ret-${suffix}`, dataRetentionDays },
  });
  orgIds.push(organization.id);
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `ret-${suffix}` },
  });
  const contexts = {} as Org["contexts"];
  for (const role of ["ORG_ADMIN", "EDITOR", "ANALYST"] as MembershipRole[]) {
    const user = await prisma.user.create({
      data: { name: role, email: `ret-${role.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
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

async function createCampaign(org: Org, extra: Partial<Prisma.CampaignUncheckedCreateInput> = {}) {
  const suffix = randomUUID().slice(0, 8);
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      workspaceId: org.workspaceId,
      type: "MEMORY",
      internalName: `Ret ${suffix}`,
      ownerId: org.userId,
      slug: `ret-${suffix}`,
      status: "PUBLISHED",
      ...extra,
      leadForm: {
        create: {
          position: "BEFORE_GAME",
          consentDefinitions: { create: [{ text: "Aceito receber novidades", isMarketing: true, order: 0 }] },
        },
      },
    },
    include: { leadForm: { include: { consentDefinitions: true } } },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: org.userId },
  });

  /** Uma lead completa, com tudo o que a anonimização tem de levar. */
  const lead = async (createdAt: Date, email = `lead-${randomUUID().slice(0, 6)}@example.pt`, participantId?: string) => {
    const participant =
      participantId ??
      (
        await prisma.participant.create({
          data: { organizationId: org.id, cookieId: `cookie-${randomUUID()}`, email: "antigo@example.pt" },
        })
      ).id;
    const participation = await prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        participantId: participant,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
        createdAt,
        startedAt: createdAt,
        completedAt: new Date(createdAt.getTime() + 60_000),
        email,
        phone: "912345678",
        firstName: "Ana",
        lastName: "Silva",
        leadFormResponse: { email, nome: "Ana Silva" },
        resultSummary: { completed: true, score: 80 },
        ipAddress: "203.0.113.7",
        sessionId: randomUUID(),
        source: "google.com",
        utmSource: "newsletter",
        utmContent: "subscriber-123",
        utmTerm: "ana",
        deviceType: "mobile",
      },
    });
    await prisma.consentRecord.create({
      data: {
        participationId: participation.id,
        consentDefinitionId: campaign.leadForm!.consentDefinitions[0]!.id,
        status: "GRANTED",
        text: "Aceito receber novidades",
        version: 1,
      },
    });
    return { participation, participantId: participant };
  };

  return { campaign, version, lead };
}

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const IDENTITY_FIELDS = {
  email: null,
  phone: null,
  firstName: null,
  lastName: null,
  ipAddress: null,
  sessionId: null,
  participantId: null,
  utmContent: null,
  utmTerm: null,
} as const;

let a: Org;
let b: Org;

beforeEach(async () => {
  a = await createOrg("a", 30);
  b = await createOrg("b");
});

afterEach(async () => {
  state.current = null;
  delete process.env.CRON_SECRET;
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
  await prisma.auditLog.deleteMany({
    where: { organizationId: null, entityType: RETENTION_RUN_ENTITY, createdAt: { gte: testStartedAt } },
  });
  await prisma.$disconnect();
});

describe("tarefa diária do prazo de conservação", () => {
  it("anonimiza só o que passou o prazo, e só o que é pessoal", async () => {
    const { campaign, lead } = await createCampaign(a);
    const old = await lead(daysAgo(40), "velha@example.pt");
    // Origem gravada antes de se guardar só o endereço: o URL inteiro, com
    // um identificador de quem clicou.
    await prisma.participation.update({
      where: { id: old.participation.id },
      data: { source: "https://news.example/abrir?subscriber=123#topo" },
    });
    const recent = await lead(daysAgo(10), "recente@example.pt");
    // O mesmo browser jogou há 40 e há 10 dias: o participante fica.
    const shared = await lead(daysAgo(45), "partilhado@example.pt");
    await lead(daysAgo(5), "partilhado-2@example.pt", shared.participantId);
    // Outra organização, sem prazo: não é tocada.
    const other = await createCampaign(b);
    const foreign = await other.lead(daysAgo(400), "alheia@example.pt");

    const summary = await runDataRetention();

    expect(summary).toMatchObject({ failedCampaigns: 0, timedOut: false });
    const anonymized = await prisma.participation.findUniqueOrThrow({
      where: { id: old.participation.id },
      include: { consentRecords: true },
    });
    expect(anonymized).toMatchObject({
      ...IDENTITY_FIELDS,
      leadFormResponse: {},
      // Fica o que alimenta as estatísticas e o resultado.
      status: "COMPLETED",
      resultSummary: { completed: true, score: 80 },
      source: "news.example",
      utmSource: "newsletter",
      deviceType: "mobile",
    });
    expect(anonymized.anonymizedAt).not.toBeNull();
    // O consentimento fica, sem ninguém a quem se ligue.
    expect(anonymized.consentRecords).toHaveLength(1);
    // O participante só tinha esta participação: sai, com os dados antigos.
    expect(await prisma.participant.findUnique({ where: { id: old.participantId } })).toBeNull();
    // O partilhado continua a ter uma participação com dados; os dados
    // antigos dele (podiam ser de quem saiu) já não.
    expect(await prisma.participant.findUnique({ where: { id: shared.participantId } })).toMatchObject({
      email: null,
      cookieId: expect.any(String),
    });

    expect(await prisma.participation.findUniqueOrThrow({ where: { id: recent.participation.id } })).toMatchObject({
      email: "recente@example.pt",
      anonymizedAt: null,
    });
    expect(await prisma.participation.findUniqueOrThrow({ where: { id: foreign.participation.id } })).toMatchObject({
      email: "alheia@example.pt",
      anonymizedAt: null,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: a.id, action: "PRIVACY_OPERATION", entityId: campaign.id },
    });
    expect(audit.metadata).toMatchObject({
      operation: "retention",
      participationsAnonymized: 2,
      participantsDeleted: 1,
      retention: { kind: "days", days: 30, source: "organization" },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("@example.pt");
    expect(await lastRetentionRun()).not.toBeNull();
  });

  it("é idempotente: a segunda execução não encontra nada, mesmo em paralelo", async () => {
    const { campaign, lead } = await createCampaign(a);
    for (let index = 0; index < 5; index += 1) await lead(daysAgo(31 + index));

    const [first, second] = await Promise.all([runDataRetention(), runDataRetention()]);
    const third = await runDataRetention();

    // Cada participação foi anonimizada uma vez, por uma das duas.
    const ours = async () =>
      (
        await prisma.auditLog.findMany({
          where: { organizationId: a.id, action: "PRIVACY_OPERATION", entityId: campaign.id },
        })
      ).reduce((sum, audit) => sum + ((audit.metadata as { participationsAnonymized: number }).participationsAnonymized ?? 0), 0);
    expect(await ours()).toBe(5);
    expect(first.failedCampaigns + second.failedCampaigns + third.failedCampaigns).toBe(0);
    expect(await prisma.participation.count({ where: { campaignId: campaign.id, anonymizedAt: null } })).toBe(0);
  });

  it("o prazo da campanha vence o da organização", async () => {
    const longer = await createCampaign(a, { dataRetentionDays: 365 });
    const kept = await longer.lead(daysAgo(100));
    const until = await createCampaign(a, { dataRetentionUntil: daysAgo(1) });
    const dayOld = await until.lead(daysAgo(2));
    const justNow = await until.lead(new Date(Date.now() - 60 * 60 * 1000));

    await runDataRetention();

    expect((await prisma.participation.findUniqueOrThrow({ where: { id: kept.participation.id } })).anonymizedAt).toBeNull();
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: dayOld.participation.id } })).anonymizedAt).not.toBeNull();
    // Com menos de um dia (pode estar a jogar): fica para a execução seguinte.
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: justNow.participation.id } })).anonymizedAt).toBeNull();
  });

  it("as estatísticas não mudam: participações, leads e consentimentos continuam a contar", async () => {
    const { campaign, lead } = await createCampaign(a);
    await lead(daysAgo(40));
    await lead(daysAgo(35));
    await lead(daysAgo(3));
    const range = resolveDateRange({ period: "all" });
    const before = await getCampaignStats(a.id, range, { campaignId: campaign.id });

    await runDataRetention();

    const after = await getCampaignStats(a.id, range, { campaignId: campaign.id });
    expect(after.general).toMatchObject({
      participations: before.general.participations,
      completions: before.general.completions,
      leads: before.general.leads,
      bySource: before.general.bySource,
      byDevice: before.general.byDevice,
    });
    expect(await listLeads(a.id, range, { campaignId: campaign.id, marketingConsent: "granted" })).toMatchObject({ total: 3 });
    expect(await listLeads(a.id, range, { campaignId: campaign.id, hideAnonymized: true })).toMatchObject({ total: 1 });
  });

  it("por lotes, com limite de tempo: retoma onde ficou", async () => {
    const { campaign, lead } = await createCampaign(a);
    for (let index = 0; index < 3; index += 1) await lead(daysAgo(40 + index));
    const cutoff = daysAgo(30);

    const first = await anonymizeCampaignBefore(
      { id: campaign.id, organizationId: a.id },
      cutoff,
      { now: new Date(), deadline: Date.now(), batchSize: 1 },
    );
    expect(first).toMatchObject({ participationsAnonymized: 1, timedOut: true });

    const rest = await anonymizeCampaignBefore(
      { id: campaign.id, organizationId: a.id },
      cutoff,
      { now: new Date(), deadline: Date.now() + 60_000, batchSize: 1 },
    );
    expect(rest).toMatchObject({ participationsAnonymized: 2, timedOut: false });
  });

  it("quem começa a jogar noutra campanha durante a anonimização não perde o participante", async () => {
    const { lead } = await createCampaign(a);
    const other = await createCampaign(a, { dataRetentionDays: 365 });
    const old = await lead(daysAgo(40));

    // A participação nova, com o mesmo browser, fica por confirmar enquanto
    // a tarefa corre; só depois se confirma.
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    let inserted!: () => void;
    const insertedSignal = new Promise<void>((resolve) => (inserted = resolve));
    const concurrent = prisma.$transaction(
      async (tx) => {
        await tx.participation.create({
          data: {
            campaignId: other.campaign.id,
            campaignVersionId: other.version.id,
            participantId: old.participantId,
            idempotencyKey: randomUUID(),
          },
        });
        inserted();
        await committed;
      },
      { timeout: 20_000 },
    );
    await insertedSignal;
    const run = anonymizeParticipationsByIds(a.id, [old.participation.id]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    commit();
    await Promise.all([concurrent, run]);

    expect(await prisma.participant.findUnique({ where: { id: old.participantId } })).not.toBeNull();
    const created = await prisma.participation.findMany({ where: { campaignId: other.campaign.id } });
    expect(created.map((participation) => participation.participantId)).toEqual([old.participantId]);
  });
});

describe("anonimização e eliminação ao mesmo tempo", () => {
  it("anonimizar uma campanha enquanto ela é eliminada não dá deadlock", async () => {
    const { deleteCampaignAction } = await import("@/features/campaigns/actions");
    state.current = a.contexts.ORG_ADMIN;
    for (let round = 0; round < 3; round += 1) {
      const { campaign, lead } = await createCampaign(a);
      const ids: string[] = [];
      for (let index = 0; index < 40; index += 1) ids.push((await lead(daysAgo(40))).participation.id);
      const form = new FormData();
      form.set("campaignId", campaign.id);
      const results = await Promise.allSettled([
        anonymizeParticipationsByIds(a.id, ids),
        deleteCampaignAction(form),
        anonymizeCampaignBefore({ id: campaign.id, organizationId: a.id }, daysAgo(30), {
          now: new Date(),
          deadline: Date.now() + 30_000,
        }),
      ]);
      const failures = results.filter((result) => result.status === "rejected").map((result) => String((result as PromiseRejectedResult).reason));
      expect(failures).toEqual([]);
      expect(await prisma.campaign.findUnique({ where: { id: campaign.id } })).toBeNull();
    }
  }, 60_000);
});

describe("avisos antes da anonimização", () => {
  it("mostra o que sai nos próximos dias e distingue a tarefa parada da atrasada", async () => {
    const { campaign, lead } = await createCampaign(a);
    await lead(daysAgo(25)); // sai daqui a 5 dias
    await lead(daysAgo(40)); // passou o prazo há 10 dias
    await lead(daysAgo(5)); // longe
    // As de teste também saem, mas não entram no aviso.
    const test = await lead(daysAgo(26));
    await prisma.participation.update({ where: { id: test.participation.id }, data: { isTest: true } });

    const outlook = await retentionOutlook(a.id);

    expect(outlook).toHaveLength(1);
    expect(outlook[0]).toMatchObject({ campaignId: campaign.id, upcoming: 2, overdue: 1, dueNow: true });
    // Sem nenhuma execução recente e com leads fora do prazo: parada.
    expect(retentionJobStatus(outlook, null)).toBe("stopped");
    // Uma execução recente que não chegou a tudo: atrasada, não parada.
    expect(retentionJobStatus(outlook, { at: new Date() })).toBe("behind");

    await runDataRetention();
    const afterRun = await retentionOutlook(a.id);
    expect(afterRun[0]).toMatchObject({ upcoming: 1, overdue: 0, dueNow: false });
    expect(retentionJobStatus(afterRun, await lastRetentionRun())).toBe("ok");
    // Outra organização não vê nada disto.
    expect(await retentionOutlook(b.id)).toEqual([]);
  });

  it("um prazo acabado de mudar dá 7 dias de aviso, sem falso alarme", async () => {
    const { campaign, lead } = await createCampaign(a);
    const old = await lead(daysAgo(200));
    state.current = a.contexts.ORG_ADMIN;
    // 30 → 90: as leads de 200 dias ficam fora do prazo novo, mas só saem
    // daqui a 7 dias.
    const saved = await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "90" }));
    expect(saved).toMatchObject({ status: "success", message: expect.stringContaining("daqui a 7 dias") });

    await runDataRetention();
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: old.participation.id } })).anonymizedAt).toBeNull();
    const outlook = await retentionOutlook(a.id);
    expect(outlook[0]).toMatchObject({ campaignId: campaign.id, upcoming: 1, overdue: 0, dueNow: false });
    expect(outlook[0]!.nextAt!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
    expect(retentionJobStatus(outlook, null)).toBe("ok");

    // Passados os 7 dias, sai.
    await runDataRetention({ now: new Date(Date.now() + 8 * DAY) });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: old.participation.id } })).anonymizedAt).not.toBeNull();
  });
});

describe("anonimização manual", () => {
  it("o administrador anonimiza as selecionadas, só as da sua organização", async () => {
    const { lead } = await createCampaign(a);
    const first = await lead(daysAgo(1));
    const second = await lead(daysAgo(1));
    const untouched = await lead(daysAgo(1));
    const foreign = await (await createCampaign(b)).lead(daysAgo(1), "alheia@example.pt");
    state.current = a.contexts.ORG_ADMIN;

    const result = await anonymizeLeadsAction(
      IDLE,
      form({ scope: "selection", participationId: [first.participation.id, second.participation.id, foreign.participation.id] }),
    );

    expect(result).toMatchObject({ status: "success", message: "2 leads anonimizadas." });
    const rows = await prisma.participation.findMany({
      where: { id: { in: [first.participation.id, second.participation.id, untouched.participation.id, foreign.participation.id] } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(first.participation.id)).toMatchObject(IDENTITY_FIELDS);
    expect(byId.get(second.participation.id)?.anonymizedAt).not.toBeNull();
    expect(byId.get(untouched.participation.id)?.anonymizedAt).toBeNull();
    expect(byId.get(foreign.participation.id)).toMatchObject({ email: "alheia@example.pt", anonymizedAt: null });

    // Dois registos: antes de começar e no fim, com as contagens.
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: a.id, action: "PRIVACY_OPERATION", entityType: "Participation" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((audit) => (audit.metadata as { stage: string }).stage)).toEqual(["started", "completed"]);
    expect(audits[1]!.metadata).toMatchObject({ operation: "anonymize", scope: "selection", requested: 3, participationsAnonymized: 2 });

    // De novo: já não há nada.
    expect(
      await anonymizeLeadsAction(IDLE, form({ scope: "selection", participationId: [first.participation.id] })),
    ).toMatchObject({ status: "success", message: "Não havia leads por anonimizar." });
  });

  it("pelos filtros: só com a contagem confirmada, as que existiam quando a página abriu, e nunca com pesquisa", async () => {
    const { campaign, lead } = await createCampaign(a);
    await lead(daysAgo(2));
    await lead(daysAgo(3));
    state.current = a.contexts.ORG_ADMIN;
    const asOf = new Date().toISOString();
    const filters = { scope: "filters", campaignId: campaign.id, period: "all", excludeTest: "false", asOf };

    // Com uma pesquisa (que procura partes do texto), recusa.
    expect(await anonymizeLeadsAction(IDLE, form({ ...filters, search: "lead", expected: "2" }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("Pedido de um titular"),
    });
    // Uma lead que chega depois de a página abrir não entra.
    const late = await lead(new Date(Date.now() + 1_000));
    // A contagem não bate certo: a lista mudou (ou o período, à meia-noite).
    expect(await anonymizeLeadsAction(IDLE, form({ ...filters, expected: "3" }))).toMatchObject({
      status: "error",
      message: expect.stringContaining("A lista mudou"),
    });

    expect(await anonymizeLeadsAction(IDLE, form({ ...filters, expected: "2" }))).toMatchObject({
      status: "success",
      message: "2 leads anonimizadas.",
    });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: late.participation.id } })).anonymizedAt).toBeNull();
  });

  it("pedido de um titular: o e-mail exato, em todas as campanhas e nas respostas; não os parecidos", async () => {
    const one = await createCampaign(a);
    const two = await createCampaign(a);
    const mine1 = await one.lead(daysAgo(2), "ana@example.pt");
    const mine2 = await two.lead(daysAgo(300), "ANA@example.pt".toLowerCase());
    // Noutra lead, a ana aparece só num segundo campo de e-mail (indicou uma amiga).
    const referral = await one.lead(daysAgo(1), "amiga@example.pt");
    await prisma.participation.update({
      where: { id: referral.participation.id },
      data: { leadFormResponse: { email: "amiga@example.pt", amigo: " Ana@Example.pt " } },
    });
    const joana = await one.lead(daysAgo(2), "joana@example.pt");
    const mariana = await two.lead(daysAgo(2), "mariana@example.pt");
    // Dados antigos no Participant com o mesmo e-mail.
    const legacy = await prisma.participant.create({
      data: { organizationId: a.id, cookieId: `legacy-${randomUUID()}`, email: "ana@example.pt", firstName: "Ana" },
    });
    state.current = a.contexts.ORG_ADMIN;

    const preview = await anonymizeLeadsAction(IDLE, form({ scope: "subject", subject: " Ana@Example.pt ", intent: "preview" }));
    expect(preview).toMatchObject({ status: "success", message: "3 participações com este e-mail exato, em 2 campanhas." });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: mine1.participation.id } })).anonymizedAt).toBeNull();

    const result = await anonymizeLeadsAction(IDLE, form({ scope: "subject", subject: "ana@example.pt", intent: "anonymize" }));
    expect(result).toMatchObject({ status: "success", message: "3 leads anonimizadas." });
    for (const { participation } of [mine1, mine2, referral]) {
      expect((await prisma.participation.findUniqueOrThrow({ where: { id: participation.id } })).anonymizedAt).not.toBeNull();
    }
    for (const { participation } of [joana, mariana]) {
      expect((await prisma.participation.findUniqueOrThrow({ where: { id: participation.id } })).anonymizedAt).toBeNull();
    }
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ email: null, firstName: null });

    // Nada do pedido (o e-mail) vai para a auditoria.
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: a.id, action: "PRIVACY_OPERATION", entityType: "Participation" },
    });
    expect(audits.length).toBe(2);
    expect(JSON.stringify(audits.map((audit) => audit.metadata))).not.toContain("ana");
    expect(audits.find((audit) => (audit.metadata as { stage: string }).stage === "completed")?.metadata).toMatchObject({
      scope: "subject",
      identifierKind: "email",
      participationsAnonymized: 3,
    });

    // Um identificador incompleto é recusado.
    expect(await anonymizeLeadsAction(IDLE, form({ scope: "subject", subject: "ana", intent: "preview" }))).toMatchObject({
      status: "error",
    });
  });

  it("pedido de um titular pelo telefone, escrito de outra forma", async () => {
    const { lead } = await createCampaign(a);
    const mine = await lead(daysAgo(2)); // telefone 912345678
    state.current = a.contexts.ORG_ADMIN;
    const result = await anonymizeLeadsAction(IDLE, form({ scope: "subject", subject: "912 345 678", intent: "anonymize" }));
    expect(result).toMatchObject({ status: "success", message: "1 lead anonimizada." });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: mine.participation.id } })).phone).toBeNull();
  });

  it("o editor e o analista não anonimizam nem mudam o prazo", async () => {
    const { campaign, lead } = await createCampaign(a);
    const target = await lead(daysAgo(1));
    for (const role of ["EDITOR", "ANALYST"] as const) {
      state.current = a.contexts[role];
      expect(
        await anonymizeLeadsAction(IDLE, form({ scope: "selection", participationId: [target.participation.id] })),
      ).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });
      expect(
        await anonymizeLeadsAction(IDLE, form({ scope: "subject", subject: "ana@example.pt", intent: "preview" })),
      ).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });
      expect(await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "" }))).toMatchObject({ status: "error" });
      expect(
        await updateCampaignRetentionAction(IDLE, form({ campaignId: campaign.id, retention: "365", retentionUntil: "" })),
      ).toMatchObject({ status: "error" });
    }
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: target.participation.id } })).anonymizedAt).toBeNull();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).dataRetentionDays).toBe(30);
  });
});

describe("configuração do prazo", () => {
  it("da organização: um dos prazos sugeridos, ou nenhum; a data da alteração só muda com o valor", async () => {
    state.current = a.contexts.ORG_ADMIN;
    expect((await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "180" }))).status).toBe("success");
    const first = await prisma.organization.findUniqueOrThrow({ where: { id: a.id } });
    expect(first.dataRetentionDays).toBe(180);
    expect(first.dataRetentionChangedAt).not.toBeNull();
    // O mesmo valor outra vez (um autosave repetido) não reinicia o aviso.
    await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "180" }));
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).dataRetentionChangedAt).toEqual(
      first.dataRetentionChangedAt,
    );
    expect(await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "45" }))).toMatchObject({
      status: "error",
      fieldErrors: { dataRetentionDays: "Prazo de conservação: opção inválida." },
    });
    expect((await updateOrganizationRetentionAction(IDLE, form({ dataRetentionDays: "" }))).status).toBe("success");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).dataRetentionDays).toBeNull();
  });

  it("da campanha: dias, uma data a pelo menos 7 dias no fuso da campanha, ou o da organização", async () => {
    const { campaign } = await createCampaign(a, { timezone: "Europe/Lisbon" });
    state.current = a.contexts.ORG_ADMIN;
    const save = (retention: string, retentionUntil = "") =>
      updateCampaignRetentionAction(IDLE, form({ campaignId: campaign.id, retention, retentionUntil }));
    const stored = () =>
      prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id }, select: { dataRetentionDays: true, dataRetentionUntil: true } });

    expect((await save("90")).status).toBe("success");
    expect(await stored()).toEqual({ dataRetentionDays: 90, dataRetentionUntil: null });

    const nextYear = new Date().getUTCFullYear() + 1;
    expect((await save("until", `${nextYear}-07-01`)).status).toBe("success");
    // 00:00 em Lisboa no verão é 23:00 UTC da véspera.
    expect(await stored()).toEqual({ dataRetentionDays: null, dataRetentionUntil: new Date(`${nextYear}-06-30T23:00:00Z`) });

    const soon = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10);
    for (const date of ["2020-01-01", soon]) {
      expect(await save("until", date)).toMatchObject({
        status: "error",
        fieldErrors: { retentionUntil: expect.stringContaining("pelo menos 7 dias depois de hoje") },
      });
    }
    expect(await save("until", "")).toMatchObject({ status: "error", fieldErrors: { retentionUntil: expect.any(String) } });
    expect((await stored()).dataRetentionUntil).not.toBeNull();

    expect((await save("inherit")).status).toBe("success");
    expect(await stored()).toEqual({ dataRetentionDays: null, dataRetentionUntil: null });
  });

  it("não muda o prazo de uma campanha de outra organização", async () => {
    const foreign = await createCampaign(b);
    state.current = a.contexts.ORG_ADMIN;
    await expect(
      updateCampaignRetentionAction(IDLE, form({ campaignId: foreign.campaign.id, retention: "30", retentionUntil: "" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: foreign.campaign.id } })).dataRetentionDays).toBeNull();
  });
});

describe("rota do cron", () => {
  const call = (authorization?: string) =>
    cronRoute.GET(
      new Request("http://localhost:3000/api/cron/retention", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("sem CRON_SECRET configurado recusa sempre; com ele, só com o segredo certo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call("Bearer qualquer")).status).toBe(503);

    process.env.CRON_SECRET = "segredo-de-teste";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer errado")).status).toBe(401);
    expect((await call("segredo-de-teste")).status).toBe(401);

    const { lead } = await createCampaign(a);
    const old = await lead(daysAgo(40));
    const response = await call("Bearer segredo-de-teste");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ failedCampaigns: 0, timedOut: false });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: old.participation.id } })).anonymizedAt).not.toBeNull();
  });
});
