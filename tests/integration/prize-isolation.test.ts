import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Isolamento de prémios entre organizações (auditoria C1 e C2).
 *
 * As server actions correm a sério contra a base de dados; só se substitui o
 * que depende de um pedido HTTP: a sessão (quem está autenticado), o
 * `revalidatePath` e o rate limit (Redis, que o job de testes do CI não tem).
 * Os módulos de autenticação reais nem chegam a ser carregados: o next-auth
 * não resolve `next/server` fora do runtime do Next.
 */

const session = vi.hoisted(() => ({ current: null as OrgContext | null }));

vi.mock("@/server/auth/session", () => ({
  requireOrgContext: async () => {
    if (!session.current) throw new Error("Sem sessão de teste.");
    return session.current;
  },
}));
// O jogo público corre para um visitante anónimo.
vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));

const { addWheelSegmentAction, updateWheelSegmentAction } = await import("@/features/wheel-game/actions");
const { removePrizeAction } = await import("@/features/prizes/actions");
const { spinWheelAction } = await import("@/features/play/actions");
const { drawAndAwardPrize, NoEligibleSegmentsError } = await import("@/features/wheel-game/draw");

const NOT_FOUND = { digest: expect.stringContaining("404") };

async function createOrgWithWheel(label: string) {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Teste ${suffix}`, slug: `teste-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `teste-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Teste", slug: `teste-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "WHEEL",
      internalName: `Roda ${suffix}`,
      ownerId: user.id,
      slug: `roda-${suffix}`,
      wheelConfig: { create: {} },
    },
    include: { wheelConfig: true },
  });
  const wheelConfigId = campaign.wheelConfig!.id;
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });
  const prize = await prisma.prize.create({
    data: { campaignId: campaign.id, internalName: "Voucher", publicName: "Voucher", totalQuantity: 10 },
  });
  const code = await prisma.prizeCode.create({
    data: { prizeId: prize.id, code: `CODE-${suffix}` },
  });
  const segment = await prisma.wheelSegment.create({
    data: {
      wheelConfigId,
      order: 0,
      name: "Ganhou",
      colorHex: "#00AEEF",
      outcome: "WIN",
      prizeId: prize.id,
      weight: 1,
    },
  });

  const context: OrgContext = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    isSuperAdmin: false,
    organizationId: organization.id,
    membership,
  };

  const createParticipation = () =>
    prisma.participation.create({
      data: { campaignId: campaign.id, campaignVersionId: version.id, idempotencyKey: randomUUID() },
    });

  const cleanup = async () => {
    await prisma.analyticsEvent.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.prizeAward.deleteMany({ where: { participation: { campaignId: campaign.id } } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.wheelSegment.deleteMany({ where: { wheelConfigId } });
    await prisma.prizeAward.deleteMany({ where: { prize: { campaignId: campaign.id } } });
    await prisma.prize.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.wheelConfig.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.membership.delete({ where: { id: membership.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };

  return {
    campaignId: campaign.id,
    wheelConfigId,
    prizeId: prize.id,
    codeId: code.id,
    segmentId: segment.id,
    context,
    createParticipation,
    cleanup,
  };
}

type Fixture = Awaited<ReturnType<typeof createOrgWithWheel>>;

function segmentForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  const defaults = { name: "Segmento", colorHex: "#FFA931", outcome: "WIN", weight: "5", isActive: "on" };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) form.set(key, value);
  return form;
}

let attacker: Fixture;
let victim: Fixture;

beforeEach(async () => {
  attacker = await createOrgWithWheel("a");
  victim = await createOrgWithWheel("b");
  session.current = attacker.context;
});

afterEach(async () => {
  session.current = null;
  // A ordem importa: um segmento do atacante pode apontar para o prémio da vítima.
  await attacker.cleanup();
  await victim.cleanup();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("segmentos da roda só aceitam prémios da própria campanha", () => {
  it("recusa criar um segmento ligado ao prémio de outra organização", async () => {
    const form = segmentForm({ campaignId: attacker.campaignId, prizeId: victim.prizeId });

    await expect(addWheelSegmentAction(form)).rejects.toMatchObject(NOT_FOUND);

    const linked = await prisma.wheelSegment.count({
      where: { wheelConfigId: attacker.wheelConfigId, prizeId: victim.prizeId },
    });
    expect(linked).toBe(0);
  });

  it("recusa mudar um segmento existente para o prémio de outra organização", async () => {
    const form = segmentForm({
      campaignId: attacker.campaignId,
      segmentId: attacker.segmentId,
      prizeId: victim.prizeId,
    });

    await expect(updateWheelSegmentAction(form)).rejects.toMatchObject(NOT_FOUND);

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: attacker.segmentId } });
    expect(segment.prizeId).toBe(attacker.prizeId);
  });

  it("recusa o prémio de outra campanha da mesma organização", async () => {
    const other = await prisma.campaign.create({
      data: {
        organizationId: attacker.context.organizationId,
        workspaceId: (await prisma.campaign.findUniqueOrThrow({ where: { id: attacker.campaignId } })).workspaceId,
        type: "WHEEL",
        internalName: "Outra roda",
        ownerId: attacker.context.userId,
        slug: `outra-${randomUUID().slice(0, 8)}`,
      },
    });
    const otherPrize = await prisma.prize.create({
      data: { campaignId: other.id, internalName: "Outro", publicName: "Outro" },
    });
    try {
      const form = segmentForm({ campaignId: attacker.campaignId, prizeId: otherPrize.id });
      await expect(addWheelSegmentAction(form)).rejects.toMatchObject(NOT_FOUND);
    } finally {
      await prisma.prize.delete({ where: { id: otherPrize.id } });
      await prisma.campaign.delete({ where: { id: other.id } });
    }
  });

  it("continua a aceitar o prémio da própria campanha", async () => {
    const form = segmentForm({ campaignId: attacker.campaignId, prizeId: attacker.prizeId, name: "Novo" });

    await addWheelSegmentAction(form);

    const created = await prisma.wheelSegment.findFirstOrThrow({
      where: { wheelConfigId: attacker.wheelConfigId, name: "Novo" },
    });
    expect(created.prizeId).toBe(attacker.prizeId);
  });

  it("um segmento NO_WIN nunca guarda prémio, mesmo que o formulário traga um", async () => {
    const form = segmentForm({
      campaignId: attacker.campaignId,
      outcome: "NO_WIN",
      prizeId: victim.prizeId,
      name: "Perdeu",
    });

    await addWheelSegmentAction(form);

    const created = await prisma.wheelSegment.findFirstOrThrow({
      where: { wheelConfigId: attacker.wheelConfigId, name: "Perdeu" },
    });
    expect(created.prizeId).toBeNull();
  });
});

describe("o sorteio nunca toca em prémios de outra campanha", () => {
  // Simula dados gravados antes da verificação nas ações: a ligação é feita
  // diretamente na base de dados.
  async function linkAttackerSegmentToVictimPrize() {
    await prisma.wheelSegment.update({
      where: { id: attacker.segmentId },
      data: { prizeId: victim.prizeId, weight: 10_000 },
    });
  }

  it("ignora o segmento com prémio alheio e não consome o stock nem os códigos da vítima", async () => {
    await linkAttackerSegmentToVictimPrize();
    await prisma.wheelSegment.create({
      data: {
        wheelConfigId: attacker.wheelConfigId,
        order: 1,
        name: "Não foi desta vez",
        colorHex: "#9CAEB8",
        outcome: "NO_WIN",
        weight: 1,
      },
    });

    for (let i = 0; i < 5; i += 1) {
      const participation = await attacker.createParticipation();
      const result = await drawAndAwardPrize(participation.id);
      expect(result.outcome).toBe("NO_WIN");
    }

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: victim.prizeId } });
    expect(prize.awardedQuantity).toBe(0);
    const code = await prisma.prizeCode.findUniqueOrThrow({ where: { id: victim.codeId } });
    expect(code.status).toBe("AVAILABLE");
    expect(await prisma.prizeAward.count({ where: { prizeId: victim.prizeId } })).toBe(0);
  });

  it("sem outro segmento elegível, recusa a rotação em vez de usar o prémio alheio", async () => {
    await linkAttackerSegmentToVictimPrize();
    const participation = await attacker.createParticipation();

    await expect(drawAndAwardPrize(participation.id)).rejects.toBeInstanceOf(NoEligibleSegmentsError);

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: victim.prizeId } });
    expect(prize.awardedQuantity).toBe(0);
  });
});

describe("o browser não recebe ids internos de prémios", () => {
  it("a rotação devolve o prémio sem o id, também quando repetida", async () => {
    const participation = await victim.createParticipation();

    const first = await spinWheelAction(participation.id);
    const repeated = await spinWheelAction(participation.id);

    for (const result of [first, repeated]) {
      expect(result.outcome).toBe("WIN");
      expect(result.prize).not.toBeNull();
      expect(result.prize).not.toHaveProperty("id");
      expect(JSON.stringify(result)).not.toContain(victim.prizeId);
    }
    // A repetição devolve o mesmo resultado, sem sortear outra vez.
    expect(repeated).toEqual(first);
    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: victim.prizeId } });
    expect(prize.awardedQuantity).toBe(1);
  });
});

describe("remover um prémio só afeta a própria campanha", () => {
  it("recusa remover o prémio de outra organização e não desliga os segmentos dela", async () => {
    const form = new FormData();
    form.set("campaignId", attacker.campaignId);
    form.set("prizeId", victim.prizeId);

    await expect(removePrizeAction(form)).rejects.toMatchObject(NOT_FOUND);

    const victimSegment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: victim.segmentId } });
    expect(victimSegment.prizeId).toBe(victim.prizeId);
    expect(await prisma.prize.count({ where: { id: victim.prizeId } })).toBe(1);
  });

  it("remove o próprio prémio e desliga os segmentos que o usavam", async () => {
    const form = new FormData();
    form.set("campaignId", attacker.campaignId);
    form.set("prizeId", attacker.prizeId);

    await removePrizeAction(form);

    expect(await prisma.prize.count({ where: { id: attacker.prizeId } })).toBe(0);
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: attacker.segmentId } });
    expect(segment.prizeId).toBeNull();
  });

  it("não elimina um prémio já atribuído", async () => {
    const participation = await attacker.createParticipation();
    await drawAndAwardPrize(participation.id);

    const form = new FormData();
    form.set("campaignId", attacker.campaignId);
    form.set("prizeId", attacker.prizeId);
    await removePrizeAction(form);

    expect(await prisma.prize.count({ where: { id: attacker.prizeId } })).toBe(1);
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: attacker.segmentId } });
    expect(segment.prizeId).toBe(attacker.prizeId);
  });
});
