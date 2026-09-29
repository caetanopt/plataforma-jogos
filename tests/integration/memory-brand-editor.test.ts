import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { CampaignTheme, MemoryGameConfig, MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";
import type { ActionResult } from "@/lib/forms/action-result";

/**
 * Editor do Jogo da Memória e da marca (passo 5a): as ações devolvem o
 * resultado ao formulário, um campo inválido não deita fora os outros e os
 * campos que o formulário não envia ficam como estão.
 *
 * As ações correm a sério contra a base de dados; só se substitui a sessão e
 * o cache do Next. Cada teste envia os campos que a página envia de facto.
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

const { IDLE, NOTHING_SAVED_MESSAGE, PARTIAL_SAVE_MESSAGE } =
  await import("@/lib/forms/action-result");
const { CARD_ASPECT_RATIO_MESSAGE, MEMORY_PAIR_MESSAGES } =
  await import("@/lib/validation/memory-game");
const {
  updateMemoryConfigAction,
  addMemoryPairAction,
  removeMemoryPairAction,
  moveMemoryPairAction,
} = await import("@/features/memory-game/actions");
const { updateCampaignThemeAction, saveAsBrandKitAction, applyBrandKitAction } =
  await import("@/features/campaigns/steps/brand-actions");
const {
  createBrandKitAction,
  updateBrandKitAction,
  deleteBrandKitAction,
  updateOrganizationLogoAction,
} = await import("@/features/brand/actions");

const NOT_FOUND = { digest: expect.stringContaining("404") };
const MEDIA_UNAVAILABLE = "A imagem escolhida não está disponível. Carregue-a de novo.";

interface Org {
  id: string;
  workspaceId: string;
  admin: OrgContext;
  editor: OrgContext;
  userIds: string[];
}

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `MB ${suffix}`, slug: `mb-${suffix}` },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `mb-${suffix}` },
  });

  const userIds: string[] = [];
  async function member(role: MembershipRole): Promise<OrgContext> {
    const user = await prisma.user.create({
      data: {
        name: role,
        email: `mb-${role.toLowerCase()}-${suffix}@example.com`,
        passwordHash: "x",
      },
    });
    userIds.push(user.id);
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role },
    });
    return {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      isSuperAdmin: false,
      organizationId: organization.id,
      membership,
    };
  }

  return {
    id: organization.id,
    workspaceId: workspace.id,
    admin: await member("ORG_ADMIN"),
    // Sem "brand:manage".
    editor: await member("EDITOR"),
    userIds,
  };
}

let org: Org;
let other: Org;

beforeAll(async () => {
  org = await createOrg("a");
  other = await createOrg("b");
});

afterAll(async () => {
  const orgIds = [org.id, other.id];
  // As campanhas primeiro: o tema é referenciado pela campanha.
  await prisma.campaign.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.campaignTheme.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.mediaAsset.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [...org.userIds, ...other.userIds] } } });
  await prisma.workspace.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

afterEach(() => {
  session.current = null;
});

function createMedia(target: Org) {
  return prisma.mediaAsset.create({
    data: {
      organizationId: target.id,
      uploadedById: target.admin.userId,
      kind: "IMAGE",
      storageKey: `uploads/${target.id}/${randomUUID()}.png`,
      url: "https://cdn.test/x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    },
  });
}

/** Campanha de Memória com valores diferentes dos por omissão em todos os campos. */
async function createMemoryCampaign(target: Org) {
  const cardBack = await createMedia(target);
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: target.id,
      workspaceId: target.workspaceId,
      type: "MEMORY",
      internalName: "Memória",
      ownerId: target.admin.userId,
      slug: `mb-mem-${randomUUID()}`,
      memoryConfig: {
        create: {
          columns: 5,
          randomizeOrder: true,
          cardAspectRatio: "3/4",
          cardGapPx: 12,
          timeLimitSeconds: 90,
          maxAttempts: 30,
          pointsPerPair: 15,
          penaltyPerMistake: 2,
          speedBonusEnabled: true,
          previewSeconds: 3,
          soundEnabled: true,
          rankingEnabled: true,
          rankingMaxEntries: 20,
          rankingAnonymize: true,
          cardBackMediaId: cardBack.id,
        },
      },
    },
    include: { memoryConfig: true },
  });
  return { campaign, config: campaign.memoryConfig! };
}

function reloadConfig(id: string) {
  return prisma.memoryGameConfig.findUniqueOrThrow({ where: { id } });
}

function toForm(
  fields: Record<string, string | undefined>,
  checkboxes: Record<string, boolean> = {},
): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  // CheckboxField: sentinela sempre, "on" quando marcada.
  for (const [name, checked] of Object.entries(checkboxes)) {
    data.append(name, "");
    if (checked) data.append(name, "on");
  }
  return data;
}

/** O que o formulário de configuração da Memória envia: os valores gravados mais as alterações. */
function memoryConfigForm(
  campaignId: string,
  config: MemoryGameConfig,
  changes: Record<string, string> = {},
  checks: Record<string, boolean> = {},
): FormData {
  return toForm(
    {
      campaignId,
      columns: String(config.columns),
      cardAspectRatio: config.cardAspectRatio,
      cardGapPx: String(config.cardGapPx),
      timeLimitSeconds: config.timeLimitSeconds == null ? "" : String(config.timeLimitSeconds),
      maxAttempts: config.maxAttempts == null ? "" : String(config.maxAttempts),
      previewSeconds: config.previewSeconds == null ? "" : String(config.previewSeconds),
      pointsPerPair: String(config.pointsPerPair),
      penaltyPerMistake: String(config.penaltyPerMistake),
      rankingMaxEntries: config.rankingMaxEntries == null ? "" : String(config.rankingMaxEntries),
      cardBackMediaId: config.cardBackMediaId ?? "",
      ...changes,
    },
    {
      randomizeOrder: config.randomizeOrder,
      speedBonusEnabled: config.speedBonusEnabled,
      soundEnabled: config.soundEnabled,
      rankingEnabled: config.rankingEnabled,
      rankingAnonymize: config.rankingAnonymize,
      ...checks,
    },
  );
}

function fieldErrors(result: ActionResult): Record<string, string> {
  return result.status === "error" ? { ...result.fieldErrors } : {};
}

describe("configuração do Jogo da Memória (gravação automática)", () => {
  it("colunas apagadas: erro em Colunas, os outros campos gravam e as colunas ficam", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;

    const result = await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(
        campaign.id,
        config,
        { columns: "", pointsPerPair: "25", timeLimitSeconds: "" },
        { soundEnabled: false },
      ),
    );

    expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
    expect(fieldErrors(result)).toEqual({ columns: "Colunas: obrigatório." });
    const saved = await reloadConfig(config.id);
    expect(saved.columns).toBe(5);
    expect(saved.pointsPerPair).toBe(25);
    // Vazio = sem limite.
    expect(saved.timeLimitSeconds).toBeNull();
    expect(saved.soundEnabled).toBe(false);
    expect(saved.cardAspectRatio).toBe("3/4");
    expect(saved.cardBackMediaId).toBe(config.cardBackMediaId);
    expect(saved.rankingAnonymize).toBe(true);
  });

  it("proporção fora do formato: erro com a mensagem do formato, o valor gravado fica", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;

    for (const cardAspectRatio of ["alto", "3:4", "0/4", "123/4"]) {
      const result = await updateMemoryConfigAction(
        IDLE,
        memoryConfigForm(campaign.id, config, { cardAspectRatio, cardGapPx: "20" }),
      );
      expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
      expect(fieldErrors(result)).toEqual({ cardAspectRatio: CARD_ASPECT_RATIO_MESSAGE });
    }

    const saved = await reloadConfig(config.id);
    expect(saved.cardAspectRatio).toBe("3/4");
    expect(saved.cardGapPx).toBe(20);

    const valid = await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { cardAspectRatio: " 2/3 " }),
    );
    expect(valid.status).toBe("success");
    expect((await reloadConfig(config.id)).cardAspectRatio).toBe("2/3");
  });

  it("números fora dos limites voltam com a label do campo", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;

    const result = await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, {
        columns: "9",
        previewSeconds: "31",
        rankingMaxEntries: "0",
        timeLimitSeconds: "0",
        penaltyPerMistake: "1,5",
      }),
    );

    expect(fieldErrors(result)).toEqual({
      columns: "Colunas: máximo 8.",
      previewSeconds: "Pré-visualização inicial: máximo 30.",
      rankingMaxEntries: "Limite do ranking: mínimo 1.",
      timeLimitSeconds: "Tempo limite: mínimo 1.",
      penaltyPerMistake: "Penalização por erro: tem de ser um número.",
    });
    const saved = await reloadConfig(config.id);
    expect(saved).toMatchObject({
      columns: 5,
      previewSeconds: 3,
      rankingMaxEntries: 20,
      timeLimitSeconds: 90,
      penaltyPerMistake: 2,
    });
  });

  it("um envio sem as checkboxes nem o verso não os altera", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;

    const result = await updateMemoryConfigAction(
      IDLE,
      toForm({ campaignId: campaign.id, cardGapPx: "4" }),
    );

    expect(result.status).toBe("success");
    const saved = await reloadConfig(config.id);
    expect(saved).toMatchObject({ ...config, cardGapPx: 4 });
  });

  it("verso das cartas de outra organização: recusado e nada gravado", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    const foreign = await createMedia(other);
    session.current = org.editor;

    const result = await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { cardBackMediaId: foreign.id, pointsPerPair: "99" }),
    );

    expect(result).toMatchObject({ status: "error", message: MEDIA_UNAVAILABLE });
    expect(await reloadConfig(config.id)).toEqual(config);
  });

  it("verso das cartas removido: grava null", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;

    const result = await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { cardBackMediaId: "" }),
    );

    expect(result.status).toBe("success");
    expect((await reloadConfig(config.id)).cardBackMediaId).toBeNull();
  });

  it("audita só quando muda um campo da pontuação, com o antes e o depois", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;
    const audits = () =>
      prisma.auditLog.findMany({ where: { entityType: "MemoryGameConfig", entityId: config.id } });

    await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { cardGapPx: "30" }),
    );
    // Pontuação inválida não é gravada, e por isso não é auditada.
    await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { pointsPerPair: "" }),
    );
    expect(await audits()).toHaveLength(0);

    await updateMemoryConfigAction(
      IDLE,
      memoryConfigForm(campaign.id, config, { pointsPerPair: "40" }),
    );
    const entries = await audits();
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata).toMatchObject({
      pointsPerPairBefore: 15,
      pointsPerPairAfter: 40,
      timeLimitSecondsBefore: 90,
      timeLimitSecondsAfter: 90,
    });
  });

  it("campanha de outra organização: notFound", async () => {
    const { campaign, config } = await createMemoryCampaign(other);
    session.current = org.editor;

    await expect(
      updateMemoryConfigAction(IDLE, memoryConfigForm(campaign.id, config)),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await reloadConfig(config.id)).toEqual(config);
  });
});

describe("pares do Jogo da Memória", () => {
  /** O que o formulário de par envia: só os campos que o tipo mostra. */
  function pairForm(campaignId: string, fields: Record<string, string>) {
    return toForm({ campaignId, ...fields });
  }

  function pairsOf(configId: string) {
    return prisma.memoryCardPair.findMany({
      where: { memoryGameConfigId: configId },
      orderBy: { order: "asc" },
    });
  }

  it("cada tipo exige os seus campos, com o erro no campo em falta", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    const image = await createMedia(org);
    session.current = org.editor;

    const cases: Array<[Record<string, string>, Record<string, string>]> = [
      [
        { kind: "SAME_IMAGE", cardAMediaId: "", cardAAltText: "", cardBAltText: "" },
        { cardAMediaId: MEMORY_PAIR_MESSAGES.sameImage },
      ],
      [
        {
          kind: "DIFFERENT_IMAGE_MATCH",
          cardAMediaId: image.id,
          cardBMediaId: "",
          cardAAltText: "",
          cardBAltText: "",
        },
        { cardBMediaId: MEMORY_PAIR_MESSAGES.imageB },
      ],
      [
        {
          kind: "DIFFERENT_IMAGE_MATCH",
          cardAMediaId: "",
          cardBMediaId: "",
          cardAAltText: "",
          cardBAltText: "",
        },
        { cardAMediaId: MEMORY_PAIR_MESSAGES.imageA, cardBMediaId: MEMORY_PAIR_MESSAGES.imageB },
      ],
      [
        { kind: "IMAGE_TEXT", cardAMediaId: image.id, cardBText: "  ", cardAAltText: "" },
        { cardBText: MEMORY_PAIR_MESSAGES.textB },
      ],
      [
        { kind: "IMAGE_TEXT", cardAMediaId: "", cardBText: "Leão", cardAAltText: "" },
        { cardAMediaId: MEMORY_PAIR_MESSAGES.imageA },
      ],
      [
        { kind: "TEXT_TEXT", cardAText: "", cardBText: "B" },
        { cardAText: MEMORY_PAIR_MESSAGES.textA },
      ],
      [
        { kind: "TEXT_TEXT", cardAText: "A", cardBText: "" },
        { cardBText: MEMORY_PAIR_MESSAGES.textB },
      ],
      // Um tipo que não existe (nem um nome do protótipo) não rebenta a validação.
      [
        { kind: "constructor", cardAText: "A", cardBText: "B" },
        { kind: "Tipo de par: opção inválida." },
      ],
    ];

    for (const [fields, expected] of cases) {
      const result = await addMemoryPairAction(IDLE, pairForm(campaign.id, fields));
      expect(result.status, JSON.stringify(fields)).toBe("error");
      expect(fieldErrors(result)).toEqual(expected);
    }
    expect(await pairsOf(config.id)).toHaveLength(0);
  });

  it("pares válidos: gravam só o que o tipo usa, pela ordem", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    const imageA = await createMedia(org);
    const imageB = await createMedia(org);
    session.current = org.editor;

    const results = [
      await addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, {
          kind: "SAME_IMAGE",
          cardAMediaId: imageA.id,
          cardAAltText: "Leão",
          cardBAltText: "Leão",
        }),
      ),
      await addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, {
          kind: "DIFFERENT_IMAGE_MATCH",
          cardAMediaId: imageA.id,
          cardBMediaId: imageB.id,
          cardAAltText: "",
          cardBAltText: "Cria",
        }),
      ),
      await addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, {
          kind: "IMAGE_TEXT",
          cardAMediaId: imageA.id,
          cardBText: " Leão ",
          cardAAltText: "",
        }),
      ),
      // Um id de media enviado num par de textos não fica no par.
      await addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, {
          kind: "TEXT_TEXT",
          cardAText: "Sol",
          cardBText: "Lua",
          cardAMediaId: imageA.id,
        }),
      ),
    ];
    for (const result of results)
      expect(result).toMatchObject({ status: "success", message: "Par adicionado." });

    const pairs = await pairsOf(config.id);
    expect(pairs.map((pair) => pair.order)).toEqual([0, 1, 2, 3]);
    expect(pairs[0]).toMatchObject({
      kind: "SAME_IMAGE",
      cardAMediaId: imageA.id,
      cardBMediaId: imageA.id,
      cardAAltText: "Leão",
      cardAText: null,
    });
    expect(pairs[1]).toMatchObject({
      cardAMediaId: imageA.id,
      cardBMediaId: imageB.id,
      cardAAltText: null,
      cardBAltText: "Cria",
    });
    expect(pairs[2]).toMatchObject({
      cardAMediaId: imageA.id,
      cardBMediaId: null,
      cardBText: "Leão",
      cardBAltText: null,
    });
    expect(pairs[3]).toMatchObject({
      cardAMediaId: null,
      cardBMediaId: null,
      cardAText: "Sol",
      cardBText: "Lua",
    });
  });

  it("imagem de outra organização: recusada e o par não é criado", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    const foreign = await createMedia(other);
    session.current = org.editor;

    const result = await addMemoryPairAction(
      IDLE,
      pairForm(campaign.id, {
        kind: "SAME_IMAGE",
        cardAMediaId: foreign.id,
        cardAAltText: "",
        cardBAltText: "",
      }),
    );

    expect(result).toMatchObject({ status: "error", message: MEDIA_UNAVAILABLE });
    expect(await pairsOf(config.id)).toHaveLength(0);
  });

  it("mover nas pontas e remover um par que já não existe devolvem erro", async () => {
    const { campaign, config } = await createMemoryCampaign(org);
    session.current = org.editor;
    for (const text of ["Um", "Dois"]) {
      await addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, { kind: "TEXT_TEXT", cardAText: text, cardBText: text }),
      );
    }
    const [first, second] = await pairsOf(config.id);
    const move = (pairId: string, direction: string) =>
      moveMemoryPairAction(IDLE, toForm({ campaignId: campaign.id, pairId, direction }));

    expect(await move(first.id, "up")).toMatchObject({
      status: "error",
      message: "O par já é o primeiro da lista.",
    });
    expect(await move(second.id, "down")).toMatchObject({
      status: "error",
      message: "O par já é o último da lista.",
    });
    expect(await move(first.id, "down")).toMatchObject({ status: "success" });
    expect((await pairsOf(config.id)).map((pair) => pair.id)).toEqual([second.id, first.id]);

    const remove = (pairId: string) =>
      removeMemoryPairAction(IDLE, toForm({ campaignId: campaign.id, pairId }));
    expect(await remove(first.id)).toMatchObject({ status: "success" });
    expect(await remove(first.id)).toMatchObject({
      status: "error",
      message: "Este par já não existe. Recarregue a página.",
    });
    expect(await move(first.id, "up")).toMatchObject({
      status: "error",
      message: "Este par já não existe. Recarregue a página.",
    });
  });

  it("pares de uma campanha de outra organização: notFound", async () => {
    const { campaign, config } = await createMemoryCampaign(other);
    session.current = other.editor;
    await addMemoryPairAction(
      IDLE,
      pairForm(campaign.id, { kind: "TEXT_TEXT", cardAText: "X", cardBText: "Y" }),
    );
    const [pair] = await pairsOf(config.id);
    session.current = org.editor;

    await expect(
      addMemoryPairAction(
        IDLE,
        pairForm(campaign.id, { kind: "TEXT_TEXT", cardAText: "A", cardBText: "B" }),
      ),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      removeMemoryPairAction(IDLE, toForm({ campaignId: campaign.id, pairId: pair.id })),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await pairsOf(config.id)).toHaveLength(1);
  });
});

async function createThemedCampaign(target: Org) {
  const [logo, favicon, background] = await Promise.all([
    createMedia(target),
    createMedia(target),
    createMedia(target),
  ]);
  const theme = await prisma.campaignTheme.create({
    data: {
      organizationId: target.id,
      name: "Tema da campanha",
      logoMediaId: logo.id,
      faviconMediaId: favicon.id,
      backgroundImageMediaId: background.id,
      primaryColor: "#111111",
      secondaryColor: "#222222",
      backgroundColor: "#333333",
      textColor: "#444444",
      buttonColor: "#555555",
      buttonTextColor: "#666666",
      fontFamily: "Inter",
      borderRadiusPx: 12,
      shadowEnabled: true,
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: target.id,
      workspaceId: target.workspaceId,
      type: "QUIZ",
      internalName: "Com tema",
      ownerId: target.admin.userId,
      slug: `mb-theme-${randomUUID()}`,
      themeId: theme.id,
    },
  });
  return { campaign, theme };
}

function createBrandKit(
  target: Org,
  values: Pick<
    Partial<CampaignTheme>,
    "logoMediaId" | "faviconMediaId" | "backgroundImageMediaId"
  > = {},
) {
  return prisma.campaignTheme.create({
    data: {
      organizationId: target.id,
      name: `Kit ${randomUUID().slice(0, 6)}`,
      isBrandKit: true,
      primaryColor: "#AA0000",
      secondaryColor: "#00AA00",
      backgroundColor: "#0000AA",
      textColor: "#AAAA00",
      buttonColor: "#00AAAA",
      buttonTextColor: "#AA00AA",
      fontFamily: "Roboto",
      borderRadiusPx: 30,
      shadowEnabled: false,
      ...values,
    },
  });
}

function reloadTheme(id: string) {
  return prisma.campaignTheme.findUniqueOrThrow({ where: { id } });
}

/** O que o ThemeFieldset envia: os valores gravados mais as alterações. */
function themeFields(
  theme: CampaignTheme,
  changes: Record<string, string> = {},
): Record<string, string> {
  return {
    logoMediaId: theme.logoMediaId ?? "",
    faviconMediaId: theme.faviconMediaId ?? "",
    backgroundImageMediaId: theme.backgroundImageMediaId ?? "",
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    backgroundColor: theme.backgroundColor,
    textColor: theme.textColor,
    buttonColor: theme.buttonColor,
    buttonTextColor: theme.buttonTextColor,
    fontFamily: theme.fontFamily,
    borderRadiusPx: String(theme.borderRadiusPx),
    ...changes,
  };
}

/** Página Marca e design: sem o nome do tema. */
function campaignThemeForm(
  campaignId: string,
  theme: CampaignTheme,
  changes: Record<string, string> = {},
  shadow = theme.shadowEnabled,
) {
  return toForm({ campaignId, ...themeFields(theme, changes) }, { shadowEnabled: shadow });
}

/** Página Identidade visual: o kit leva o nome. */
function brandKitForm(
  kit: CampaignTheme,
  changes: Record<string, string> = {},
  shadow = kit.shadowEnabled,
) {
  return toForm(
    { kitId: kit.id, name: kit.name, ...themeFields(kit, changes) },
    { shadowEnabled: shadow },
  );
}

describe("tema da campanha (gravação automática)", () => {
  it("cores e border radius inválidos voltam com erro; o resto do tema grava", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    session.current = org.editor;

    const result = await updateCampaignThemeAction(
      IDLE,
      campaignThemeForm(
        campaign.id,
        theme,
        {
          primaryColor: "vermelho",
          borderRadiusPx: "",
          secondaryColor: "#ABCDEF",
          fontFamily: "Arial",
        },
        false,
      ),
    );

    expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
    expect(fieldErrors(result)).toEqual({
      primaryColor: "Cor primária: cor inválida.",
      borderRadiusPx: "Border radius: obrigatório.",
    });
    const saved = await reloadTheme(theme.id);
    expect(saved).toMatchObject({
      name: "Tema da campanha",
      primaryColor: "#111111",
      borderRadiusPx: 12,
      secondaryColor: "#ABCDEF",
      fontFamily: "Arial",
      shadowEnabled: false,
      logoMediaId: theme.logoMediaId,
      faviconMediaId: theme.faviconMediaId,
      backgroundImageMediaId: theme.backgroundImageMediaId,
    });
  });

  it("imagem de fundo removida grava null; o nome enviado por engano não muda o tema", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    session.current = org.editor;

    const form = campaignThemeForm(campaign.id, theme, { backgroundImageMediaId: "" });
    form.set("name", "Outro nome");
    const result = await updateCampaignThemeAction(IDLE, form);

    expect(result.status).toBe("success");
    const saved = await reloadTheme(theme.id);
    expect(saved.backgroundImageMediaId).toBeNull();
    expect(saved.name).toBe("Tema da campanha");
    expect(saved.logoMediaId).toBe(theme.logoMediaId);
  });

  it("logótipo de outra organização: recusado e nada gravado", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    const foreign = await createMedia(other);
    session.current = org.editor;

    const result = await updateCampaignThemeAction(
      IDLE,
      campaignThemeForm(campaign.id, theme, { logoMediaId: foreign.id, primaryColor: "#000000" }),
    );

    expect(result).toMatchObject({ status: "error", message: MEDIA_UNAVAILABLE });
    expect(await reloadTheme(theme.id)).toEqual(theme);
  });

  it("nada válido: não escreve nem audita", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    session.current = org.editor;

    const result = await updateCampaignThemeAction(
      IDLE,
      toForm({ campaignId: campaign.id, textColor: "#12" }),
    );

    expect(result).toMatchObject({ status: "error", message: NOTHING_SAVED_MESSAGE });
    expect(fieldErrors(result)).toEqual({ textColor: "Cor do texto: cor inválida." });
    expect(await reloadTheme(theme.id)).toEqual(theme);
    expect(await prisma.auditLog.count({ where: { entityId: theme.id } })).toBe(0);
  });
});

describe("brand kits", () => {
  it("aplicar um brand kit copia os valores do kit para o tema da campanha", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    const kitLogo = await createMedia(org);
    const kit = await createBrandKit(org, { logoMediaId: kitLogo.id, faviconMediaId: null });
    session.current = org.editor;

    const result = await applyBrandKitAction(
      IDLE,
      toForm({ campaignId: campaign.id, brandKitId: kit.id }),
    );

    expect(result).toMatchObject({ status: "success", message: "Brand kit aplicado." });
    const saved = await reloadTheme(theme.id);
    expect(saved).toMatchObject({
      sourceBrandKitId: kit.id,
      name: "Tema da campanha",
      logoMediaId: kitLogo.id,
      faviconMediaId: null,
      backgroundImageMediaId: null,
      primaryColor: "#AA0000",
      secondaryColor: "#00AA00",
      backgroundColor: "#0000AA",
      textColor: "#AAAA00",
      buttonColor: "#00AAAA",
      buttonTextColor: "#AA00AA",
      fontFamily: "Roboto",
      borderRadiusPx: 30,
      shadowEnabled: false,
    });
    // O kit fica como estava: a campanha recebe uma cópia.
    expect(await reloadTheme(kit.id)).toEqual(kit);
  });

  it("aplicar um kit de outra organização: notFound e o tema fica", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    const foreignKit = await createBrandKit(other);
    session.current = org.editor;

    await expect(
      applyBrandKitAction(IDLE, toForm({ campaignId: campaign.id, brandKitId: foreignKit.id })),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await reloadTheme(theme.id)).toEqual(theme);
  });

  it("guardar como brand kit: nome obrigatório; com nome, copia o tema gravado", async () => {
    const { campaign, theme } = await createThemedCampaign(org);
    session.current = org.admin;

    const empty = await saveAsBrandKitAction(
      IDLE,
      toForm({ campaignId: campaign.id, kitName: "   " }),
    );
    expect(empty).toMatchObject({ status: "error" });
    expect(fieldErrors(empty)).toEqual({ kitName: "Nome do brand kit: obrigatório." });

    const tooLong = await saveAsBrandKitAction(
      IDLE,
      toForm({ campaignId: campaign.id, kitName: "x".repeat(121) }),
    );
    expect(fieldErrors(tooLong)).toEqual({ kitName: "Nome do brand kit: máximo 120 caracteres." });

    const name = `Kit guardado ${randomUUID().slice(0, 6)}`;
    const result = await saveAsBrandKitAction(
      IDLE,
      toForm({ campaignId: campaign.id, kitName: ` ${name} ` }),
    );
    expect(result).toMatchObject({ status: "success", message: "Brand kit guardado." });
    const kit = await prisma.campaignTheme.findFirstOrThrow({
      where: { organizationId: org.id, name },
    });
    expect(kit).toMatchObject({
      isBrandKit: true,
      logoMediaId: theme.logoMediaId,
      primaryColor: theme.primaryColor,
      fontFamily: theme.fontFamily,
      borderRadiusPx: theme.borderRadiusPx,
      shadowEnabled: theme.shadowEnabled,
    });
  });

  it("guardar como brand kit exige a permissão de gerir a marca", async () => {
    const { campaign } = await createThemedCampaign(org);
    session.current = org.editor;
    const name = `Sem permissão ${randomUUID().slice(0, 6)}`;

    const result = await saveAsBrandKitAction(
      IDLE,
      toForm({ campaignId: campaign.id, kitName: name }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: "Não tem permissão para fazer esta alteração.",
    });
    expect(await prisma.campaignTheme.count({ where: { name } })).toBe(0);
  });

  it("criar brand kit: nome vazio recusado no campo name", async () => {
    session.current = org.admin;

    const empty = await createBrandKitAction(IDLE, toForm({ name: "" }));
    expect(empty).toMatchObject({ status: "error" });
    expect(fieldErrors(empty)).toEqual({ name: "Nome do brand kit: obrigatório." });

    const name = `Novo kit ${randomUUID().slice(0, 6)}`;
    const created = await createBrandKitAction(IDLE, toForm({ name }));
    expect(created).toMatchObject({ status: "success", message: "Brand kit criado." });
    expect(
      await prisma.campaignTheme.count({
        where: { organizationId: org.id, name, isBrandKit: true },
      }),
    ).toBe(1);
  });

  it("editar brand kit: nome apagado volta com erro e fica; as cores gravam", async () => {
    const kit = await createBrandKit(org);
    session.current = org.admin;

    const result = await updateBrandKitAction(
      IDLE,
      brandKitForm(kit, { name: " ", buttonColor: "#FFA931" }, true),
    );

    expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
    expect(fieldErrors(result)).toEqual({ name: "Nome: obrigatório." });
    const saved = await reloadTheme(kit.id);
    expect(saved).toMatchObject({
      name: kit.name,
      buttonColor: "#FFA931",
      shadowEnabled: true,
      fontFamily: "Roboto",
    });
  });

  it("editar ou eliminar um brand kit de outra organização: notFound", async () => {
    const foreignKit = await createBrandKit(other);
    session.current = org.admin;

    await expect(
      updateBrandKitAction(IDLE, brandKitForm(foreignKit, { name: "Roubado" })),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      deleteBrandKitAction(IDLE, toForm({ kitId: foreignKit.id })),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await reloadTheme(foreignKit.id)).toEqual(foreignKit);
  });

  it("eliminar um brand kit próprio", async () => {
    const kit = await createBrandKit(org);
    session.current = org.admin;

    expect(await deleteBrandKitAction(IDLE, toForm({ kitId: kit.id }))).toMatchObject({
      status: "success",
    });
    expect(await prisma.campaignTheme.count({ where: { id: kit.id } })).toBe(0);
  });
});

describe("logótipo da organização", () => {
  function logoOf(organizationId: string) {
    return prisma.organization
      .findUniqueOrThrow({ where: { id: organizationId }, select: { logoMediaId: true } })
      .then((row) => row.logoMediaId);
  }

  it("grava o logótipo carregado e remove-o com o campo vazio", async () => {
    const logo = await createMedia(org);
    session.current = org.admin;

    expect(
      await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: logo.id })),
    ).toMatchObject({ status: "success" });
    expect(await logoOf(org.id)).toBe(logo.id);

    expect(await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: "" }))).toMatchObject({
      status: "success",
    });
    expect(await logoOf(org.id)).toBeNull();
  });

  it("logótipo de outra organização: recusado e o atual fica", async () => {
    const logo = await createMedia(org);
    const foreign = await createMedia(other);
    session.current = org.admin;
    await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: logo.id }));

    const result = await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: foreign.id }));

    expect(result).toMatchObject({ status: "error", message: MEDIA_UNAVAILABLE });
    expect(await logoOf(org.id)).toBe(logo.id);
  });

  it("sem o campo no envio: não mexe nem audita", async () => {
    const logo = await createMedia(org);
    session.current = org.admin;
    await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: logo.id }));
    const auditsBefore = await prisma.auditLog.count({
      where: { organizationId: org.id, entityType: "Organization" },
    });

    expect(await updateOrganizationLogoAction(IDLE, new FormData())).toMatchObject({
      status: "success",
    });
    expect(await logoOf(org.id)).toBe(logo.id);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: org.id, entityType: "Organization" },
      }),
    ).toBe(auditsBefore);
  });

  it("um editor sem permissão de gerir a marca não muda o logótipo", async () => {
    const logo = await createMedia(org);
    session.current = org.admin;
    await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: "" }));
    session.current = org.editor;

    const result = await updateOrganizationLogoAction(IDLE, toForm({ logoMediaId: logo.id }));

    expect(result).toMatchObject({
      status: "error",
      message: "Não tem permissão para fazer esta alteração.",
    });
    expect(await logoOf(org.id)).toBeNull();
  });
});
