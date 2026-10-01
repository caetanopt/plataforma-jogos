import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { clearLegacyParticipantIdentity, legacyIdentityReport } from "@/features/privacy/legacy-identity";

/**
 * Limpeza dos dados pessoais antigos dos participantes (§24). Sempre só nas
 * organizações deste teste: a limpeza é global, e os outros ficheiros correm
 * ao mesmo tempo com participantes seus.
 */

const orgIds: string[] = [];
let organizationId: string;
let other: string;
let campaignId: string;
let versionId: string;

async function createOrg(label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `Leg ${suffix}`, slug: `leg-${suffix}` } });
  orgIds.push(organization.id);
  return organization.id;
}

const participant = (orgId: string, data: { email?: string; firstName?: string } = {}) =>
  prisma.participant.create({ data: { organizationId: orgId, cookieId: `cookie-${randomUUID()}`, ...data } });

beforeEach(async () => {
  organizationId = await createOrg("a");
  other = await createOrg("b");
  const user = await prisma.user.create({ data: { name: "Dono", email: `leg-${randomUUID()}@example.com`, passwordHash: "x" } });
  const workspace = await prisma.workspace.create({ data: { organizationId, name: "P", slug: `leg-${randomUUID()}` } });
  const campaign = await prisma.campaign.create({
    data: { organizationId, workspaceId: workspace.id, type: "MEMORY", internalName: "Leg", ownerId: user.id, slug: `leg-${randomUUID()}` },
  });
  campaignId = campaign.id;
  versionId = (await prisma.campaignVersion.create({ data: { campaignId, versionNumber: 1, snapshot: {}, publishedById: user.id } })).id;
});

afterEach(async () => {
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
    const withData = await participant(organizationId, { email: "antiga@example.pt", firstName: "Ana" });
    const empty = await participant(organizationId);
    // A identidade já está na participação: a do participante não faz falta.
    await prisma.participation.create({
      data: {
        campaignId,
        campaignVersionId: versionId,
        participantId: withData.id,
        idempotencyKey: randomUUID(),
        email: "antiga@example.pt",
        leadFormResponse: { email: "antiga@example.pt" },
      },
    });
    const foreign = await participant(other, { email: "outra@example.pt" });

    const scope = { organizationIds: [organizationId] };
    expect(await legacyIdentityReport(scope)).toEqual({
      migrationApplied: true,
      participantsWithData: 1,
      leadsOnlyOnParticipant: 0,
      byOrganization: [{ organizationId, participants: 1 }],
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

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId, action: "PRIVACY_OPERATION" } });
    expect(audit.metadata).toEqual({ operation: "legacy_identity_cleanup", participantsCleared: 1, acceptedLoss: false });

    // Outra vez: nada a fazer.
    expect(await clearLegacyParticipantIdentity(scope)).toMatchObject({ status: "cleared", participantsCleared: 0 });
  });

  it("recusa enquanto houver leads com a identidade só no participante, a não ser que se aceite perdê-la", async () => {
    const only = await participant(organizationId, { email: "so-aqui@example.pt" });
    await prisma.participation.create({
      data: {
        campaignId,
        campaignVersionId: versionId,
        participantId: only.id,
        idempotencyKey: randomUUID(),
        // Um formulário que a cópia da migração não conseguiu mapear.
        leadFormResponse: { campoRenomeado: "so-aqui@example.pt" },
      },
    });
    const scope = { organizationIds: [organizationId] };

    expect(await clearLegacyParticipantIdentity(scope)).toMatchObject({
      status: "refused",
      reason: "leads_only_on_participant",
      report: { leadsOnlyOnParticipant: 1 },
    });
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: only.id } })).email).toBe("so-aqui@example.pt");

    expect(await clearLegacyParticipantIdentity({ ...scope, acceptLoss: true })).toMatchObject({
      status: "cleared",
      participantsCleared: 1,
    });
    expect((await prisma.participant.findUniqueOrThrow({ where: { id: only.id } })).email).toBeNull();
  });
});
