import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { LeadFieldType } from "@/generated/prisma/client";
import { clearLegacyParticipantIdentity, legacyIdentityReport } from "@/features/privacy/legacy-identity";
import { extractLeadIdentity } from "@/features/play/identity";

/**
 * Limpeza dos dados pessoais antigos dos participantes (§24). Sempre só nas
 * organizações deste teste: a limpeza é global, e os outros ficheiros correm
 * ao mesmo tempo com participantes seus. O SQL da janela do deploy também é
 * global: corre numa transação desfeita no fim.
 */

const BACKFILL_SQL = new URL("../../prisma/maintenance/backfill_participation_identity.sql", import.meta.url);

const orgIds: string[] = [];
let organizationId: string;
let other: string;

async function createOrg(label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `Leg ${suffix}`, slug: `leg-${suffix}` } });
  orgIds.push(organization.id);
  return organization.id;
}

type Field = { type: LeadFieldType; internalKey: string; order: number };

/** Uma campanha publicada; com `fields`, com formulário de leads. */
async function createCampaign(orgId: string, fields: Field[] = []) {
  const user = await prisma.user.create({ data: { name: "Dono", email: `leg-${randomUUID()}@example.com`, passwordHash: "x" } });
  const workspace = await prisma.workspace.create({ data: { organizationId: orgId, name: "P", slug: `leg-${randomUUID()}` } });
  const campaign = await prisma.campaign.create({
    data: { organizationId: orgId, workspaceId: workspace.id, type: "MEMORY", internalName: "Leg", ownerId: user.id, slug: `leg-${randomUUID()}` },
  });
  const version = await prisma.campaignVersion.create({ data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id } });
  if (fields.length > 0) {
    await prisma.leadForm.create({
      data: { campaignId: campaign.id, fields: { create: fields.map((field) => ({ ...field, label: field.internalKey })) } },
    });
  }
  return { campaignId: campaign.id, campaignVersionId: version.id };
}

const EMAIL_FORM: Field[] = [{ type: "EMAIL", internalKey: "email", order: 1 }];

const participant = (orgId: string, data: { email?: string; phone?: string; firstName?: string } = {}) =>
  prisma.participant.create({ data: { organizationId: orgId, cookieId: `cookie-${randomUUID()}`, ...data } });

const participation = (
  campaign: { campaignId: string; campaignVersionId: string },
  participantId: string | null,
  data: { leadFormResponse?: Record<string, string>; email?: string; isTest?: boolean; anonymizedAt?: Date } = {},
) => prisma.participation.create({ data: { ...campaign, participantId, idempotencyKey: randomUUID(), ...data } });

const auditRows = (orgId: string) =>
  prisma.auditLog.findMany({ where: { organizationId: orgId, action: "PRIVACY_OPERATION" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

beforeEach(async () => {
  organizationId = await createOrg("a");
  other = await createOrg("b");
});

afterEach(async () => {
  vi.restoreAllMocks();
  const where = { organizationId: { in: orgIds } };
  await prisma.participation.deleteMany({ where: { campaign: where } });
  await prisma.participant.deleteMany({ where });
  await prisma.campaignVersion.deleteMany({ where: { campaign: where } });
  const owners = (await prisma.campaign.findMany({ where, select: { ownerId: true } })).map((c) => c.ownerId);
  await prisma.campaign.deleteMany({ where });
  await prisma.user.deleteMany({ where: { id: { in: owners } } });
  await prisma.auditLog.deleteMany({ where });
  await prisma.workspace.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  orgIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("limpeza dos dados antigos dos participantes", () => {
  it("só conta por omissão; com a limpeza, tira o nome, o e-mail e o telefone e mantém o cookie", async () => {
    const campaign = await createCampaign(organizationId, EMAIL_FORM);
    const withData = await participant(organizationId, { email: "antiga@example.pt", firstName: "Ana" });
    const empty = await participant(organizationId);
    // A identidade já está na participação: a do participante não faz falta.
    await participation(campaign, withData.id, { email: "antiga@example.pt", leadFormResponse: { email: "antiga@example.pt" } });
    const foreign = await participant(other, { email: "outra@example.pt" });

    const scope = { organizationIds: [organizationId] };
    expect(await legacyIdentityReport(scope)).toEqual({
      migrationApplied: true,
      participantsWithData: 1,
      leadsOnlyOnParticipant: 0,
      ambiguousLeads: 0,
      ambiguousParticipants: 0,
      byOrganization: [
        { organizationId, participants: 1, leadsOnlyOnParticipant: 0, ambiguousLeads: 0, ambiguousParticipants: 0, participationIds: [] },
      ],
    });
    // A simulação não mudou nada.
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: withData.id } })).email).toBe("antiga@example.pt");

    const result = await clearLegacyParticipantIdentity({ ...scope, batchSize: 1 });
    expect(result).toEqual({ status: "cleared", participantsCleared: 1, byOrganization: [{ organizationId, participants: 1 }] });
    expect(await prisma.participant.findUniqueOrThrow({ where: { id: withData.id } })).toMatchObject({
      email: null,
      phone: null,
      firstName: null,
      lastName: null,
      cookieId: withData.cookieId,
      anonymizedAt: expect.any(Date),
    });
    // O vazio não conta como limpo; a outra organização não é tocada.
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: empty.id } })).anonymizedAt).toBeNull();
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: foreign.id } })).email).toBe("outra@example.pt");

    // Uma linha antes do primeiro lote e outra no fim, só com contagens.
    expect((await auditRows(organizationId)).map((row) => [row.result, row.metadata])).toEqual([
      [
        "SUCCESS",
        {
          operation: "legacy_identity_cleanup",
          stage: "started",
          participantsWithData: 1,
          leadsOnlyOnParticipant: 0,
          ambiguousLeads: 0,
          acceptedLoss: false,
        },
      ],
      ["SUCCESS", { operation: "legacy_identity_cleanup", stage: "completed", participantsCleared: 1, acceptedLoss: false }],
    ]);
    expect(await auditRows(other)).toEqual([]);

    // Outra vez: nada a fazer, e nada na auditoria.
    expect(await clearLegacyParticipantIdentity(scope)).toMatchObject({ status: "cleared", participantsCleared: 0 });
    expect(await auditRows(organizationId)).toHaveLength(2);
  });

  it("recusa enquanto houver leads com a identidade só no participante, a não ser que se aceite perdê-la", async () => {
    const campaign = await createCampaign(organizationId, EMAIL_FORM);
    const only = await participant(organizationId, { email: "so-aqui@example.pt" });
    // Um formulário que a cópia da migração não conseguiu mapear (o campo
    // foi renomeado depois da submissão).
    const lead = await participation(campaign, only.id, { leadFormResponse: { campoRenomeado: "so-aqui@example.pt" } });
    const scope = { organizationIds: [organizationId] };

    expect(await clearLegacyParticipantIdentity(scope)).toMatchObject({
      status: "refused",
      reason: "leads_only_on_participant",
      report: { leadsOnlyOnParticipant: 1, byOrganization: [{ organizationId, leadsOnlyOnParticipant: 1, participationIds: [lead.id] }] },
    });
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: only.id } })).email).toBe("so-aqui@example.pt");
    expect(await auditRows(organizationId)).toEqual([]);

    expect(await clearLegacyParticipantIdentity({ ...scope, acceptLoss: true })).toMatchObject({
      status: "cleared",
      participantsCleared: 1,
    });
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: only.id } })).email).toBeNull();
  });

  it("só conta as leads que a migração teria completado: tipos que o formulário pede, uma lead por participante, sem testes", async () => {
    // Formulário só com empresa: o participante não tem nada que lhe falte.
    const companyOnly = await createCampaign(organizationId, [{ type: "COMPANY", internalKey: "empresa", order: 1 }]);
    const company = await participant(organizationId, { email: "empresa@example.pt" });
    await participation(companyOnly, company.id, { leadFormResponse: { empresa: "ACME" } });

    const withEmail = await createCampaign(organizationId, [
      ...EMAIL_FORM,
      { type: "COMPANY", internalKey: "empresa", order: 2 },
    ]);
    // Um quiosque: duas leads no mesmo browser, a migração deixou-as em branco.
    const kiosk = await participant(organizationId, { email: "ultima-pessoa@example.pt" });
    await participation(withEmail, kiosk.id, { leadFormResponse: { antigo: "a" } });
    await participation(withEmail, kiosk.id, { leadFormResponse: { antigo: "b" } });
    // Uma participação de teste não é uma lead a perder.
    const tester = await participant(organizationId, { email: "editor@example.pt" });
    await participation(withEmail, tester.id, { leadFormResponse: { antigo: "c" }, isTest: true });
    // O participante só tem telefone, e o formulário não o pede.
    const phoneOnly = await participant(organizationId, { phone: "912345678" });
    await participation(withEmail, phoneOnly.id, { leadFormResponse: { antigo: "d" } });
    // Uma anonimizada já não tem identidade a perder.
    const anonymized = await participant(organizationId, { email: "anon@example.pt" });
    await participation(withEmail, anonymized.id, { leadFormResponse: {}, anonymizedAt: new Date() });

    const scope = { organizationIds: [organizationId, other] };
    expect(await legacyIdentityReport(scope)).toMatchObject({
      participantsWithData: 5,
      leadsOnlyOnParticipant: 0,
      ambiguousLeads: 2,
      ambiguousParticipants: 1,
      byOrganization: [{ organizationId, participants: 5, leadsOnlyOnParticipant: 0, participationIds: [] }],
    });

    // Uma lead real, única do participante, num formulário com e-mail: conta,
    // na sua organização.
    const otherCampaign = await createCampaign(other, EMAIL_FORM);
    const single = await participant(other, { email: "unica@example.pt" });
    const lead = await participation(otherCampaign, single.id, { leadFormResponse: { antigo: "e" } });
    const report = await legacyIdentityReport(scope);
    expect(report.leadsOnlyOnParticipant).toBe(1);
    expect(report.byOrganization).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organizationId, leadsOnlyOnParticipant: 0, ambiguousLeads: 2 }),
        expect.objectContaining({ organizationId: other, participants: 1, leadsOnlyOnParticipant: 1, participationIds: [lead.id] }),
      ]),
    );
    // Só ids e contagens: nada do que o participante escreveu.
    expect(JSON.stringify(report)).not.toMatch(/@example\.pt|912345678/);

    // Com a perda aceite, cada organização diz se a teve.
    expect(await clearLegacyParticipantIdentity({ ...scope, acceptLoss: true })).toMatchObject({ status: "cleared", participantsCleared: 6 });
    const stages = async (orgId: string) =>
      (await auditRows(orgId)).map((row) => {
        const metadata = row.metadata as { stage: string; acceptedLoss: boolean };
        return [metadata.stage, metadata.acceptedLoss];
      });
    expect(await stages(organizationId)).toEqual([
      ["started", false],
      ["completed", false],
    ]);
    expect(await stages(other)).toEqual([
      ["started", true],
      ["completed", true],
    ]);
  });

  it("antes das migrações não consulta as colunas novas: zero em tudo e recusa", async () => {
    const campaign = await createCampaign(organizationId, EMAIL_FORM);
    const holder = await participant(organizationId, { email: "antes@example.pt" });
    await participation(campaign, holder.id, { leadFormResponse: { email: "antes@example.pt" } });
    const scope = { organizationIds: [organizationId] };

    const original = prisma.$queryRaw.bind(prisma);
    const sqlOf = (query: unknown) => (Array.isArray(query) ? query.join("?") : "");
    const isCheck = (query: unknown) => /information_schema|_prisma_migrations/.test(sqlOf(query));
    for (const state of ["sem colunas", "colunas sem a migração"] as const) {
      const queryRaw = vi.spyOn(prisma, "$queryRaw").mockImplementation(((query: TemplateStringsArray, ...values: unknown[]) => {
        if (sqlOf(query).includes("information_schema")) {
          return Promise.resolve([{ columns: state === "sem colunas" ? 0 : 5, migrationsTable: true }]);
        }
        // A coluna "anonymizedAt" criada à mão antes do deploy: só uma das duas migrações.
        if (sqlOf(query).includes("_prisma_migrations")) return Promise.resolve([{ applied: 1 }]);
        return original(query, ...values);
      }) as unknown as typeof prisma.$queryRaw);

      expect(await legacyIdentityReport(scope)).toEqual({
        migrationApplied: false,
        participantsWithData: 0,
        leadsOnlyOnParticipant: 0,
        ambiguousLeads: 0,
        ambiguousParticipants: 0,
        byOrganization: [],
      });
      expect(await clearLegacyParticipantIdentity(scope)).toMatchObject({ status: "refused", reason: "migration_pending" });
      // Só a verificação: nenhuma query às colunas que ainda não existiam.
      expect(queryRaw.mock.calls.filter(([query]) => !isCheck(query))).toEqual([]);
      queryRaw.mockRestore();
    }

    expect((await prisma.participant.findUniqueOrThrow({ where: { id: holder.id } })).email).toBe("antes@example.pt");
    expect(await auditRows(organizationId)).toEqual([]);
  });

  it("uma falha a meio fica na auditoria com o que já saiu, e o progresso diz quantos", async () => {
    const first = await participant(organizationId, { email: "primeiro@example.pt" });
    const second = await participant(organizationId, { email: "segundo@example.pt" });
    const [low, high] = [first, second].sort((a, b) => (a.id < b.id ? -1 : 1));

    const original = prisma.$transaction.bind(prisma);
    let batches = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(((...args: Parameters<typeof prisma.$transaction>) => {
      batches += 1;
      if (batches === 2) return Promise.reject(new Error("ligação perdida"));
      return original(...args);
    }) as unknown as typeof prisma.$transaction);

    const progress = new Map<string, number>();
    await expect(clearLegacyParticipantIdentity({ organizationIds: [organizationId], batchSize: 1, progress })).rejects.toThrow(
      "ligação perdida",
    );
    expect(progress).toEqual(new Map([[organizationId, 1]]));
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: low.id } })).email).toBeNull();
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: high.id } })).email).not.toBeNull();
    expect((await auditRows(organizationId)).map((row) => [row.result, row.metadata])).toEqual([
      ["SUCCESS", expect.objectContaining({ stage: "started", participantsWithData: 2 })],
      ["FAILURE", { operation: "legacy_identity_cleanup", stage: "interrupted", participantsCleared: 1, acceptedLoss: false }],
    ]);
  });
});

describe("cópia da identidade das leads da janela do deploy (SQL)", () => {
  it("preenche a partir das respostas, com as regras do código, só nas participações sem identidade, e é idempotente", async () => {
    const fields: Field[] = [
      { type: "EMAIL", internalKey: "email2", order: 3 },
      { type: "EMAIL", internalKey: "email1", order: 1 },
      { type: "PHONE", internalKey: "tel", order: 2 },
      { type: "FULL_NAME", internalKey: "nome", order: 4 },
      { type: "FIRST_NAME", internalKey: "primeiro", order: 5 },
      { type: "LAST_NAME", internalKey: "apelido", order: 6 },
      { type: "COMPANY", internalKey: "empresa", order: 7 },
    ];
    const campaign = await createCampaign(organizationId, fields);
    const companyOnly = await createCampaign(organizationId, [{ type: "COMPANY", internalKey: "empresa", order: 1 }]);
    // Como o código antigo gravava: a identidade só na resposta (e no participante).
    const holder = await participant(organizationId, { email: "participante@example.pt" });

    const responses: Array<Record<string, string>> = [
      {
        email1: " Ana@Example.PT ",
        email2: "outra@example.pt",
        tel: "00351 912 345 678",
        nome: " Ana Silva ",
        primeiro: "Ana",
        apelido: " Silva ",
        empresa: "ACME",
      },
      ...["+351 912 345 678", "912-345-678", "(+44) 20 7946 0958", "0044 20 7946 0958", "00", "0", "sem número", "+", "  "].map(
        (tel) => ({ tel }),
      ),
      // Campos opcionais em branco: fica sem identidade, e não é reescrita.
      { email1: "   ", empresa: "ACME" },
    ];
    const filled = [];
    for (const leadFormResponse of responses) filled.push(await participation(campaign, holder.id, { leadFormResponse }));
    const anonymized = await participation(campaign, null, { leadFormResponse: { email1: "anon@example.pt" }, anonymizedAt: new Date() });
    // Já tem identidade (gravada pelo código novo): não se mexe.
    const partial = await participation(campaign, holder.id, {
      email: "ja@example.pt",
      leadFormResponse: { email1: "ja@example.pt", tel: "912345678" },
    });
    const noIdentityFields = await participation(companyOnly, holder.id, { leadFormResponse: { empresa: "ACME" } });
    const untouched = [anonymized, partial, noIdentityFields];
    const ids = [...filled, ...untouched].map((row) => row.id);

    const sql = await readFile(BACKFILL_SQL, "utf8");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const read = async () =>
      new Map(
        (
          await client.query<{ id: string; email: string | null; phone: string | null; firstName: string | null; lastName: string | null; ctid: string }>(
            `SELECT "id", "email", "phone", "firstName", "lastName", ctid::text AS ctid FROM "Participation" WHERE "id" = ANY($1::text[])`,
            [ids],
          )
        ).rows.map((row) => [row.id, row]),
      );
    try {
      // Global: numa transação desfeita no fim, para não tocar nas
      // participações dos outros ficheiros de teste.
      await client.query("BEGIN");
      await client.query(sql);
      const afterFirst = await read();

      filled.forEach((row, index) => {
        const { email, phone, firstName, lastName } = afterFirst.get(row.id)!;
        expect({ email, phone, firstName, lastName }).toEqual(extractLeadIdentity(fields, responses[index]!));
      });
      expect(afterFirst.get(filled[0]!.id)).toMatchObject({
        email: "ana@example.pt",
        phone: "+351912345678",
        firstName: "Ana Silva",
        lastName: "Silva",
      });
      expect(afterFirst.get(anonymized.id)).toMatchObject({ email: null, phone: null, firstName: null, lastName: null });
      expect(afterFirst.get(partial.id)).toMatchObject({ email: "ja@example.pt", phone: null });
      expect(afterFirst.get(noIdentityFields.id)).toMatchObject({ email: null, phone: null, firstName: null, lastName: null });

      // Outra vez: nenhuma linha reescrita (a mesma versão de cada uma).
      await client.query(sql);
      expect(await read()).toEqual(afterFirst);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.end();
    }
  });
});
