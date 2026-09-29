import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { OrgContext } from "@/server/auth/session";
import type { AuditAction } from "@/generated/prisma/client";

/**
 * Editor da Roda da Sorte (passo 5a): as ações de segmentos, prémios e
 * códigos devolvem o resultado ao formulário, e uma edição só mexe nos
 * campos que o formulário enviou.
 *
 * As ações correm a sério contra a base de dados; só se substitui o que
 * depende de um pedido HTTP: a sessão, o `revalidatePath` e o rate limit.
 */

const session = vi.hoisted(() => ({ current: null as OrgContext | null }));

vi.mock("@/server/auth/session", () => ({
  requireOrgContext: async () => {
    if (!session.current) throw new Error("Sem sessão de teste.");
    return session.current;
  },
}));
vi.mock("@/server/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));

const { IDLE } = await import("@/lib/forms/action-result");
const { utcToZonedDateTimeLocal } = await import("@/lib/dates/timezone");
const { WHEEL_EDITOR_MESSAGES, prizeTotalBelowAwardedMessage } = await import("@/lib/validation/wheel-game");
const { addWheelSegmentAction, updateWheelSegmentAction, moveWheelSegmentAction, removeWheelSegmentAction } =
  await import("@/features/wheel-game/actions");
const { addPrizeAction, updatePrizeAction, addPrizeCodeAction, removePrizeCodeAction } = await import(
  "@/features/prizes/actions"
);
const { drawAndAwardPrize } = await import("@/features/wheel-game/draw");

const TIME_ZONE = "Europe/Lisbon";
// Inverno: em Lisboa a hora local coincide com UTC, e o período fica no
// futuro (o segmento do fixture não entra nos sorteios dos testes de
// concorrência).
const PERIOD_START = new Date("2027-01-10T10:00:00.000Z");
const PERIOD_END = new Date("2027-01-20T10:00:00.000Z");

async function createFixture() {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Teste ${suffix}`, slug: `teste-editor-${suffix}` },
  });
  const otherOrganization = await prisma.organization.create({
    data: { name: `Outra ${suffix}`, slug: `outra-editor-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `editor-${suffix}@example.com`, passwordHash: "test-hash" },
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
      slug: `roda-editor-${suffix}`,
      status: "PUBLISHED",
      timezone: TIME_ZONE,
      wheelConfig: { create: {} },
    },
    include: { wheelConfig: true },
  });
  const wheelConfigId = campaign.wheelConfig!.id;
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });

  const createMedia = (organizationId: string) =>
    prisma.mediaAsset.create({
      data: {
        organizationId,
        uploadedById: user.id,
        kind: "IMAGE",
        storageKey: `uploads/${organizationId}/${randomUUID()}.png`,
        url: "https://cdn.test/x.png",
        mimeType: "image/png",
        sizeBytes: 10,
      },
    });
  const prizeImage = await createMedia(organization.id);
  const segmentImage = await createMedia(organization.id);
  const foreignImage = await createMedia(otherOrganization.id);

  const prize = await prisma.prize.create({
    data: {
      campaignId: campaign.id,
      internalName: "Voucher interno",
      publicName: "Voucher",
      description: "Descrição do voucher",
      imageMediaId: prizeImage.id,
      totalQuantity: 10,
      dailyLimit: 5,
      instructions: "Apresente o código na loja.",
      terms: "Válido em lojas aderentes.",
      startAt: PERIOD_START,
      endAt: PERIOD_END,
    },
  });
  const segment = await prisma.wheelSegment.create({
    data: {
      wheelConfigId,
      order: 0,
      name: "Ganhou",
      colorHex: "#00AEEF",
      imageMediaId: segmentImage.id,
      outcome: "WIN",
      prizeId: prize.id,
      weight: 3,
      totalQuantity: 10,
      remainingQuantity: 7,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      message: "Parabéns!",
      code: "SEG-CODE",
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

  const auditEntries = (action: AuditAction, entityId: string) =>
    prisma.auditLog.findMany({ where: { organizationId: organization.id, action, entityId } });

  const cleanup = async () => {
    await prisma.analyticsEvent.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.prizeAward.deleteMany({ where: { prize: { campaignId: campaign.id } } });
    await prisma.participation.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.wheelSegment.deleteMany({ where: { wheelConfigId } });
    await prisma.prizeCode.deleteMany({ where: { prize: { campaignId: campaign.id } } });
    await prisma.prize.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.wheelConfig.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.mediaAsset.deleteMany({ where: { uploadedById: user.id } });
    await prisma.membership.delete({ where: { id: membership.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } });
  };

  return {
    campaignId: campaign.id,
    wheelConfigId,
    prizeId: prize.id,
    segmentId: segment.id,
    prizeImageId: prizeImage.id,
    segmentImageId: segmentImage.id,
    foreignImageId: foreignImage.id,
    context,
    createParticipation,
    auditEntries,
    cleanup,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

const local = (date: Date) => utcToZonedDateTimeLocal(date, TIME_ZONE);

function buildForm(entries: Record<string, string>, isActive?: boolean): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  // CheckboxField: sentinela sempre, "on" quando marcada.
  if (isActive !== undefined) {
    form.append("isActive", "");
    if (isActive) form.append("isActive", "on");
  }
  return form;
}

/** O que o WheelSegmentForm de edição envia, com os valores gravados do fixture. */
function segmentEditForm(f: Fixture, overrides: Record<string, string> = {}, isActive = true): FormData {
  return buildForm(
    {
      campaignId: f.campaignId,
      segmentId: f.segmentId,
      name: "Ganhou",
      colorHex: "#00aeef",
      imageMediaId: f.segmentImageId,
      outcome: "WIN",
      weight: "3",
      prizeId: f.prizeId,
      totalQuantity: "10",
      code: "SEG-CODE",
      periodStart: local(PERIOD_START),
      periodEnd: local(PERIOD_END),
      message: "Parabéns!",
      ...overrides,
    },
    isActive,
  );
}

/** O que o PrizeForm de edição envia, com os valores gravados do fixture. */
function prizeEditForm(f: Fixture, overrides: Record<string, string> = {}, isActive = true): FormData {
  return buildForm(
    {
      campaignId: f.campaignId,
      prizeId: f.prizeId,
      internalName: "Voucher interno",
      publicName: "Voucher",
      description: "Descrição do voucher",
      imageMediaId: f.prizeImageId,
      totalQuantity: "10",
      dailyLimit: "5",
      instructions: "Apresente o código na loja.",
      terms: "Válido em lojas aderentes.",
      startAt: local(PERIOD_START),
      endAt: local(PERIOD_END),
      ...overrides,
    },
    isActive,
  );
}

let f: Fixture;

beforeEach(async () => {
  f = await createFixture();
  session.current = f.context;
});

afterEach(async () => {
  session.current = null;
  await f.cleanup();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("editar um segmento", () => {
  it("o formulário completo grava o que mudou e mantém o resto", async () => {
    const result = await updateWheelSegmentAction(IDLE, segmentEditForm(f, { name: "Ganhou muito", weight: "8" }));
    expect(result).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment).toMatchObject({
      name: "Ganhou muito",
      weight: 8,
      imageMediaId: f.segmentImageId,
      message: "Parabéns!",
      code: "SEG-CODE",
      prizeId: f.prizeId,
      totalQuantity: 10,
      remainingQuantity: 7,
      isActive: true,
    });
    expect(segment.periodStart).toEqual(PERIOD_START);
    expect(segment.periodEnd).toEqual(PERIOD_END);

    const odds = await f.auditEntries("ODDS_CHANGE", f.segmentId);
    expect(odds).toHaveLength(1);
    expect(odds[0].metadata).toMatchObject({ weightBefore: 3, weightAfter: 8 });
    // O total não mudou: não há registo de stock.
    expect(await f.auditEntries("STOCK_CHANGE", f.segmentId)).toHaveLength(0);
  });

  it("um formulário só com nome e peso não apaga imagem, mensagem, código, período, prémio nem stock", async () => {
    const form = buildForm({ campaignId: f.campaignId, segmentId: f.segmentId, name: "Novo nome", weight: "4" });

    expect(await updateWheelSegmentAction(IDLE, form)).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment).toMatchObject({
      name: "Novo nome",
      weight: 4,
      colorHex: "#00AEEF",
      imageMediaId: f.segmentImageId,
      outcome: "WIN",
      prizeId: f.prizeId,
      message: "Parabéns!",
      code: "SEG-CODE",
      totalQuantity: 10,
      remainingQuantity: 7,
      isActive: true,
    });
    expect(segment.periodStart).toEqual(PERIOD_START);
    expect(segment.periodEnd).toEqual(PERIOD_END);
  });

  it("interpreta o período no fuso da campanha (Lisboa no verão)", async () => {
    const form = segmentEditForm(f, { periodStart: "2026-07-20T15:00", periodEnd: "2026-07-21T09:30" });

    expect(await updateWheelSegmentAction(IDLE, form)).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.periodStart?.toISOString()).toBe("2026-07-20T14:00:00.000Z");
    expect(segment.periodEnd?.toISOString()).toBe("2026-07-21T08:30:00.000Z");
  });

  it("apagar as datas apaga o período", async () => {
    const form = segmentEditForm(f, { periodStart: "", periodEnd: "" });

    expect(await updateWheelSegmentAction(IDLE, form)).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.periodStart).toBeNull();
    expect(segment.periodEnd).toBeNull();
  });

  it("recusa um fim antes do início, em periodEnd, sem gravar nada", async () => {
    const form = segmentEditForm(f, { name: "Não gravado", periodStart: "2027-02-10T10:00", periodEnd: "2027-02-01T10:00" });

    const result = await updateWheelSegmentAction(IDLE, form);
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { periodEnd: WHEEL_EDITOR_MESSAGES.periodOrder },
    });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.name).toBe("Ganhou");
    expect(segment.periodStart).toEqual(PERIOD_START);
  });

  it("compara a ordem com a data gravada quando só uma é enviada", async () => {
    const form = buildForm({ campaignId: f.campaignId, segmentId: f.segmentId, periodStart: "2027-03-01T10:00" });

    const result = await updateWheelSegmentAction(IDLE, form);
    expect(result).toMatchObject({ status: "error", fieldErrors: { periodEnd: WHEEL_EDITOR_MESSAGES.periodOrder } });
  });

  it("recusa um peso acima do máximo com a mensagem no campo", async () => {
    const result = await updateWheelSegmentAction(IDLE, segmentEditForm(f, { weight: "10001" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { weight: "Peso: máximo 10000." } });
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.weight).toBe(3);
    expect(await f.auditEntries("ODDS_CHANGE", f.segmentId)).toHaveLength(0);
  });

  it("um peso apagado é recusado, não gravado como 0", async () => {
    const result = await updateWheelSegmentAction(IDLE, segmentEditForm(f, { weight: "" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { weight: "Peso: obrigatório." } });
  });

  it("passar a não vencedor tira o prémio (o formulário deixa de enviar o campo)", async () => {
    const form = segmentEditForm(f, { outcome: "NO_WIN" });
    form.delete("prizeId");

    expect(await updateWheelSegmentAction(IDLE, form)).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.outcome).toBe("NO_WIN");
    expect(segment.prizeId).toBeNull();
    expect((await f.auditEntries("ODDS_CHANGE", f.segmentId))[0]?.metadata).toMatchObject({
      outcomeBefore: "WIN",
      outcomeAfter: "NO_WIN",
    });
  });

  it("desmarcar Ativo desliga o segmento e regista a mudança de probabilidades", async () => {
    expect(await updateWheelSegmentAction(IDLE, segmentEditForm(f, {}, false))).toMatchObject({ status: "success" });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.isActive).toBe(false);
    expect((await f.auditEntries("ODDS_CHANGE", f.segmentId))[0]?.metadata).toMatchObject({
      isActiveBefore: true,
      isActiveAfter: false,
    });
  });

  it("mudar o total ajusta o restante sem esquecer o que já saiu", async () => {
    // 10 no total, 7 restantes: saíram 3.
    expect(await updateWheelSegmentAction(IDLE, segmentEditForm(f, { totalQuantity: "5" }))).toMatchObject({
      status: "success",
    });

    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.totalQuantity).toBe(5);
    expect(segment.remainingQuantity).toBe(2);
    const stock = await f.auditEntries("STOCK_CHANGE", f.segmentId);
    expect(stock).toHaveLength(1);
    expect(stock[0].metadata).toMatchObject({ totalQuantityBefore: 10, totalQuantityAfter: 5 });
  });

  it("recusa a imagem de outra organização", async () => {
    const result = await updateWheelSegmentAction(IDLE, segmentEditForm(f, { imageMediaId: f.foreignImageId }));

    expect(result).toMatchObject({
      status: "error",
      message: "A imagem escolhida não está disponível. Carregue-a de novo.",
    });
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: f.segmentId } });
    expect(segment.imageMediaId).toBe(f.segmentImageId);
  });
});

describe("adicionar, mover e remover segmentos", () => {
  it("devolve os erros por campo e não cria nada", async () => {
    const form = buildForm(
      { campaignId: f.campaignId, name: "", colorHex: "#00AEEF", outcome: "WIN", weight: "0", prizeId: "" },
      true,
    );

    const result = await addWheelSegmentAction(IDLE, form);
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.fieldErrors).toMatchObject({ name: "Nome: obrigatório.", weight: "Peso: mínimo 1." });
    expect(await prisma.wheelSegment.count({ where: { wheelConfigId: f.wheelConfigId } })).toBe(1);
  });

  it("cria com o período no fuso da campanha", async () => {
    const form = buildForm(
      {
        campaignId: f.campaignId,
        name: "Verão",
        colorHex: "#FFA931",
        imageMediaId: "",
        outcome: "WIN",
        weight: "2",
        prizeId: f.prizeId,
        totalQuantity: "",
        code: "",
        periodStart: "2026-07-20T15:00",
        periodEnd: "",
        message: "",
      },
      false,
    );

    expect(await addWheelSegmentAction(IDLE, form)).toMatchObject({ status: "success", message: "Segmento adicionado." });

    const created = await prisma.wheelSegment.findFirstOrThrow({
      where: { wheelConfigId: f.wheelConfigId, name: "Verão" },
    });
    expect(created.periodStart?.toISOString()).toBe("2026-07-20T14:00:00.000Z");
    expect(created.periodEnd).toBeNull();
    expect(created.isActive).toBe(false);
    expect(created.order).toBe(1);
    expect(created.totalQuantity).toBeNull();
  });

  it("mover para lá do limite devolve uma mensagem em vez de nada", async () => {
    const form = buildForm({ campaignId: f.campaignId, segmentId: f.segmentId, direction: "up" });

    expect(await moveWheelSegmentAction(IDLE, form)).toMatchObject({
      status: "error",
      message: "O segmento já é o primeiro da roda.",
    });
  });

  it("remover um segmento que já não existe devolve erro", async () => {
    const form = buildForm({ campaignId: f.campaignId, segmentId: "inexistente" });

    expect(await removeWheelSegmentAction(IDLE, form)).toMatchObject({ status: "error" });
    expect(await prisma.wheelSegment.count({ where: { id: f.segmentId } })).toBe(1);
  });
});

describe("editar um prémio", () => {
  it("o formulário completo grava o que mudou e mantém o resto", async () => {
    const result = await updatePrizeAction(IDLE, prizeEditForm(f, { publicName: "Voucher 20 €" }));
    expect(result).toMatchObject({ status: "success" });

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize).toMatchObject({
      publicName: "Voucher 20 €",
      description: "Descrição do voucher",
      imageMediaId: f.prizeImageId,
      terms: "Válido em lojas aderentes.",
      totalQuantity: 10,
      dailyLimit: 5,
      isActive: true,
    });
    expect(prize.startAt).toEqual(PERIOD_START);
    expect(prize.endAt).toEqual(PERIOD_END);
    // Nada que decida o sorteio mudou.
    expect(await f.auditEntries("ODDS_CHANGE", f.prizeId)).toHaveLength(0);
    expect(await f.auditEntries("STOCK_CHANGE", f.prizeId)).toHaveLength(0);
  });

  it("o formulário antigo (sem descrição, imagem, termos e datas) já não os apaga", async () => {
    const form = buildForm(
      {
        campaignId: f.campaignId,
        prizeId: f.prizeId,
        internalName: "Voucher interno",
        publicName: "Voucher",
        totalQuantity: "12",
        dailyLimit: "5",
        instructions: "Novas instruções",
      },
      true,
    );

    expect(await updatePrizeAction(IDLE, form)).toMatchObject({ status: "success" });

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize).toMatchObject({
      instructions: "Novas instruções",
      totalQuantity: 12,
      description: "Descrição do voucher",
      imageMediaId: f.prizeImageId,
      terms: "Válido em lojas aderentes.",
    });
    expect(prize.startAt).toEqual(PERIOD_START);
    expect(prize.endAt).toEqual(PERIOD_END);
    expect((await f.auditEntries("STOCK_CHANGE", f.prizeId))[0]?.metadata).toMatchObject({
      totalQuantityBefore: 10,
      totalQuantityAfter: 12,
    });
  });

  it("recusa uma quantidade total abaixo do já atribuído", async () => {
    await prisma.prize.update({ where: { id: f.prizeId }, data: { awardedQuantity: 3 } });

    const result = await updatePrizeAction(IDLE, prizeEditForm(f, { totalQuantity: "2", publicName: "Não gravado" }));

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { totalQuantity: prizeTotalBelowAwardedMessage(3) },
    });
    expect(prizeTotalBelowAwardedMessage(3)).toBe("Quantidade total: não pode ser inferior aos 3 já atribuídos.");
    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize.totalQuantity).toBe(10);
    expect(prize.publicName).toBe("Voucher");
  });

  it("as reservas à espera da lead também contam para o mínimo da quantidade total", async () => {
    await prisma.prize.update({ where: { id: f.prizeId }, data: { awardedQuantity: 3 } });
    const participation = await f.createParticipation();
    await prisma.prizeAward.create({
      data: {
        participationId: participation.id,
        prizeId: f.prizeId,
        status: "RESERVED",
        reservationExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await updatePrizeAction(IDLE, prizeEditForm(f, { totalQuantity: "3" }));
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { totalQuantity: prizeTotalBelowAwardedMessage(3, 1) },
    });
    expect(await updatePrizeAction(IDLE, prizeEditForm(f, { totalQuantity: "4" }))).toMatchObject({ status: "success" });
  });

  it("aceita uma quantidade total igual ao já atribuído, ou sem limite", async () => {
    await prisma.prize.update({ where: { id: f.prizeId }, data: { awardedQuantity: 3 } });

    expect(await updatePrizeAction(IDLE, prizeEditForm(f, { totalQuantity: "3" }))).toMatchObject({ status: "success" });
    expect(await updatePrizeAction(IDLE, prizeEditForm(f, { totalQuantity: "" }))).toMatchObject({ status: "success" });

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize.totalQuantity).toBeNull();
  });

  it("desativar regista a mudança de probabilidades com o antes e o depois", async () => {
    expect(await updatePrizeAction(IDLE, prizeEditForm(f, {}, false))).toMatchObject({ status: "success" });

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize.isActive).toBe(false);

    const odds = await f.auditEntries("ODDS_CHANGE", f.prizeId);
    expect(odds).toHaveLength(1);
    expect(odds[0].metadata).toEqual({
      isActiveBefore: true,
      isActiveAfter: false,
      startAtBefore: PERIOD_START.toISOString(),
      startAtAfter: PERIOD_START.toISOString(),
      endAtBefore: PERIOD_END.toISOString(),
      endAtAfter: PERIOD_END.toISOString(),
    });
  });

  it("terminar o período também regista a mudança de probabilidades, com as datas no fuso da campanha", async () => {
    const form = prizeEditForm(f, { startAt: "2026-07-01T09:00", endAt: "2026-07-20T15:00" });

    expect(await updatePrizeAction(IDLE, form)).toMatchObject({ status: "success" });

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize.startAt?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(prize.endAt?.toISOString()).toBe("2026-07-20T14:00:00.000Z");
    expect((await f.auditEntries("ODDS_CHANGE", f.prizeId))[0]?.metadata).toMatchObject({
      endAtBefore: PERIOD_END.toISOString(),
      endAtAfter: "2026-07-20T14:00:00.000Z",
    });
  });

  it("recusa um fim antes do início, em endAt", async () => {
    const result = await updatePrizeAction(IDLE, prizeEditForm(f, { endAt: "2027-01-01T10:00" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { endAt: WHEEL_EDITOR_MESSAGES.periodOrder } });
    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: f.prizeId } });
    expect(prize.endAt).toEqual(PERIOD_END);
  });

  it("recusa campos obrigatórios vazios com a mensagem no campo", async () => {
    const result = await updatePrizeAction(IDLE, prizeEditForm(f, { publicName: "  " }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { publicName: "Nome público: obrigatório." } });
  });

  it("adicionar devolve os erros por campo", async () => {
    const form = buildForm({ campaignId: f.campaignId, internalName: "", publicName: "Novo", totalQuantity: "-1" }, true);

    const result = await addPrizeAction(IDLE, form);
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { internalName: "Nome interno: obrigatório.", totalQuantity: "Quantidade total: mínimo 0." },
    });
    expect(await prisma.prize.count({ where: { campaignId: f.campaignId } })).toBe(1);
  });
});

describe("códigos de prémio", () => {
  it("recusa um código repetido no mesmo prémio, no campo code", async () => {
    const form = () => buildForm({ campaignId: f.campaignId, prizeId: f.prizeId, code: "PROMO-1", expiresAt: "" });

    expect(await addPrizeCodeAction(IDLE, form())).toMatchObject({ status: "success" });
    expect(await addPrizeCodeAction(IDLE, form())).toMatchObject({
      status: "error",
      fieldErrors: { code: WHEEL_EDITOR_MESSAGES.duplicateCode },
    });
    expect(await prisma.prizeCode.count({ where: { prizeId: f.prizeId } })).toBe(1);
  });

  it("grava a validade no fuso da campanha", async () => {
    const form = buildForm({ campaignId: f.campaignId, prizeId: f.prizeId, code: "PROMO-2", expiresAt: "2027-07-20T15:00" });

    expect(await addPrizeCodeAction(IDLE, form)).toMatchObject({ status: "success" });

    const code = await prisma.prizeCode.findFirstOrThrow({ where: { prizeId: f.prizeId, code: "PROMO-2" } });
    expect(code.expiresAt?.toISOString()).toBe("2027-07-20T14:00:00.000Z");
  });

  it("recusa uma validade no passado", async () => {
    const form = buildForm({ campaignId: f.campaignId, prizeId: f.prizeId, code: "PROMO-3", expiresAt: "2020-01-01T10:00" });

    expect(await addPrizeCodeAction(IDLE, form)).toMatchObject({
      status: "error",
      fieldErrors: { expiresAt: WHEEL_EDITOR_MESSAGES.codeExpired },
    });
  });

  it("remover um código já atribuído devolve erro e não o apaga", async () => {
    const code = await prisma.prizeCode.create({ data: { prizeId: f.prizeId, code: "DADO", status: "ASSIGNED" } });
    const form = buildForm({ campaignId: f.campaignId, codeId: code.id });

    expect(await removePrizeCodeAction(IDLE, form)).toMatchObject({
      status: "error",
      message: "O código já não está disponível: foi reservado ou atribuído entretanto.",
    });
    expect(await prisma.prizeCode.count({ where: { id: code.id } })).toBe(1);
  });
});

describe("edição concorrente com rotações", () => {
  // Um prémio e um segmento que podem sair agora (o do fixture tem o período
  // no futuro e fica fora do sorteio).
  async function createLiveSegment(options: { segmentTotal: number | null; prizeTotal: number | null }) {
    const prize = await prisma.prize.create({
      data: {
        campaignId: f.campaignId,
        internalName: "Ao vivo",
        publicName: "Ao vivo",
        totalQuantity: options.prizeTotal,
      },
    });
    const segment = await prisma.wheelSegment.create({
      data: {
        wheelConfigId: f.wheelConfigId,
        order: 1,
        name: "Ao vivo",
        colorHex: "#49B489",
        outcome: "WIN",
        prizeId: prize.id,
        weight: 1000,
        totalQuantity: options.segmentTotal,
        remainingQuantity: options.segmentTotal,
      },
    });
    return { prizeId: prize.id, segmentId: segment.id };
  }

  it("mudar o stock do segmento durante rotações não perde nenhuma unidade", async () => {
    const live = await createLiveSegment({ segmentTotal: 10, prizeTotal: null });
    const participations = await Promise.all(Array.from({ length: 5 }, () => f.createParticipation()));
    const form = buildForm({ campaignId: f.campaignId, segmentId: live.segmentId, totalQuantity: "8" });

    const [edit, ...draws] = await Promise.all([
      updateWheelSegmentAction(IDLE, form),
      ...participations.map((p) => drawAndAwardPrize(p.id)),
    ]);

    expect(edit).toMatchObject({ status: "success" });
    expect(draws.every((draw) => draw.segmentId === live.segmentId)).toBe(true);
    // Em qualquer ordem: 8 no total, 5 saídos, 3 restantes.
    const segment = await prisma.wheelSegment.findUniqueOrThrow({ where: { id: live.segmentId } });
    expect(segment.totalQuantity).toBe(8);
    expect(segment.remainingQuantity).toBe(3);
  }, 30_000);

  it("baixar o total do prémio durante rotações nunca fica abaixo do atribuído", async () => {
    const live = await createLiveSegment({ segmentTotal: null, prizeTotal: 10 });
    await prisma.wheelSegment.create({
      data: {
        wheelConfigId: f.wheelConfigId,
        order: 2,
        name: "Não foi desta vez",
        colorHex: "#9CAEB8",
        outcome: "NO_WIN",
        weight: 1,
      },
    });
    const participations = await Promise.all(Array.from({ length: 6 }, () => f.createParticipation()));
    const form = buildForm({
      campaignId: f.campaignId,
      prizeId: live.prizeId,
      internalName: "Ao vivo",
      publicName: "Ao vivo",
      totalQuantity: "3",
    });

    const [edit] = await Promise.all([
      updatePrizeAction(IDLE, form),
      ...participations.map((p) => drawAndAwardPrize(p.id)),
    ]);

    const prize = await prisma.prize.findUniqueOrThrow({ where: { id: live.prizeId } });
    expect(prize.totalQuantity).not.toBeNull();
    expect(prize.awardedQuantity).toBeLessThanOrEqual(prize.totalQuantity ?? 0);
    if (edit.status === "success") {
      expect(prize.totalQuantity).toBe(3);
    } else {
      // A gravação chegou depois de mais de 3 atribuições: recusada no campo.
      expect(edit).toMatchObject({
        status: "error",
        fieldErrors: { totalQuantity: expect.stringContaining("já atribuídos") },
      });
      expect(prize.totalQuantity).toBe(10);
    }
  }, 30_000);
});
