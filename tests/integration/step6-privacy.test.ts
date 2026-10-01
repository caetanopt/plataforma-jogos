import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";
import type { PublicGameFlowProps } from "@/components/public-game/public-game-flow";
import type { PublicThemeSource } from "@/features/brand/public-theme";

/**
 * Passo 6 (RGPD): o tema da campanha na página pública, a informação legal
 * no jogo, o contacto de privacidade da organização e os consentimentos na
 * lista e na exportação de leads.
 *
 * As ações, a página pública e a rota de exportação correm a sério contra a
 * base de dados; substitui-se só a sessão, o cache do Next, o rate limit e o
 * componente cliente do jogo, de que só interessam as props.
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
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));
vi.mock("@/components/public-game/public-game-flow", () => ({ PublicGameFlow: () => null }));
// O upload do QR code, com um gancho para simular uma edição durante ele.
const qr = vi.hoisted(() => ({ duringUpload: null as null | (() => Promise<void>) }));
vi.mock("@/features/publishing/qr", () => ({
  generateAndStoreQrCodes: async () => {
    await qr.duringUpload?.();
    return { pngMediaId: null, svgMediaId: null };
  },
}));

const { IDLE } = await import("@/lib/forms/action-result");
const { updateCampaignThemeAction } = await import("@/features/campaigns/steps/brand-actions");
const { updateBrandKitAction } = await import("@/features/brand/actions");
const { applyBrandKitAction } = await import("@/features/campaigns/steps/brand-actions");
const { updateStartScreenAction } = await import("@/features/campaigns/steps/start-screen-actions");
const { addConsentAction, addLeadFieldAction, updateConsentAction, updateLeadFormSettingsAction } = await import(
  "@/features/campaigns/steps/lead-form-actions"
);
const { LIVE_PRIVACY_NOTICE_MESSAGE } = await import("@/features/publishing/readiness");
const { CONSENT_MARKETING_LOCKED_MESSAGE } = await import("@/lib/validation/lead-form");
const { updateLeadFieldAction, removeConsentAction } = await import("@/features/campaigns/steps/lead-form-actions");
const { publishCampaignAction } = await import("@/features/publishing/actions");
const { updatePrivacySettingsAction } = await import("@/features/organizations/actions");
const { default: PublicPlayPage, generateMetadata } = await import("@/app/play/[slug]/page");
const { listLeads } = await import("@/features/leads/queries");
const { resolveDateRange } = await import("@/lib/dates/range");
const exportRoute = await import("@/app/api/leads/export/route");

interface Org {
  id: string;
  contexts: Record<"ORG_ADMIN" | "EDITOR", OrgContext>;
  userId: string;
  workspaceId: string;
}

const orgIds: string[] = [];
const userIds: string[] = [];

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `P6 ${suffix}`, slug: `p6-${suffix}` } });
  orgIds.push(organization.id);
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `p6-${suffix}` },
  });
  const contexts = {} as Org["contexts"];
  for (const role of ["ORG_ADMIN", "EDITOR"] as MembershipRole[]) {
    const user = await prisma.user.create({
      data: { name: role, email: `p6-${role.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
    });
    userIds.push(user.id);
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role },
    });
    contexts[role as "ORG_ADMIN" | "EDITOR"] = {
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

function media(org: Org, name: string) {
  return prisma.mediaAsset.create({
    data: {
      organizationId: org.id,
      uploadedById: org.userId,
      kind: "IMAGE",
      storageKey: `media/${org.id}/${name}-${randomUUID()}.png`,
      url: `https://cdn.test/${org.id}/${name}.png`,
      mimeType: "image/png",
      sizeBytes: 10,
      altText: name === "logo" ? "Marca Exemplo" : null,
    },
  });
}

async function createCampaign(org: Org, extra: { legalText?: string | null } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const theme = await prisma.campaignTheme.create({
    data: {
      organizationId: org.id,
      name: "Tema",
      primaryColor: "#8C1D18",
      backgroundColor: "#FFF6D9",
      buttonColor: "#8C1D18",
      buttonTextColor: "#FFFFFF",
      borderRadiusPx: 20,
      legalLinks: { privacyPolicyUrl: "https://marca.pt/privacidade", termsUrl: "https://marca.pt/termos" },
    },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      workspaceId: org.workspaceId,
      type: "MEMORY",
      internalName: `P6 ${suffix}`,
      ownerId: org.userId,
      slug: `p6-${suffix}`,
      status: "PUBLISHED",
      legalText: extra.legalText === undefined ? "Responsável: Marca Exemplo, Lda." : extra.legalText,
      themeId: theme.id,
      memoryConfig: { create: {} },
      leadForm: {
        create: {
          position: "BEFORE_GAME",
          fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
          consentDefinitions: {
            create: [
              { text: "Aceito o regulamento", required: true, order: 0 },
              { text: "Aceito receber novidades", isMarketing: true, order: 1, version: 3 },
            ],
          },
        },
      },
    },
    include: { leadForm: { include: { consentDefinitions: { orderBy: { order: "asc" } } } } },
  });
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: org.userId },
  });
  return { campaign, theme, version, consents: campaign.leadForm!.consentDefinitions };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
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
  await prisma.consentRecord.deleteMany({ where: { participation: { campaign: where } } });
  await prisma.participation.deleteMany({ where: { campaign: where } });
  await prisma.campaignVersion.deleteMany({ where: { campaign: where } });
  await prisma.campaign.deleteMany({ where });
  await prisma.campaignTheme.deleteMany({ where });
  await prisma.mediaAsset.deleteMany({ where });
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

/** O elemento da árvore devolvida pela página cujas props têm `key`. */
function findProps<T>(node: unknown, key: string): T | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps<T>(child, key);
      if (found) return found;
    }
    return null;
  }
  const props = (node as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  if (key in props) return props as T;
  return findProps<T>(props.children, key);
}

async function renderPlay(slug: string) {
  return PublicPlayPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) });
}

describe("tema e informação legal na página pública", () => {
  it("a página usa o tema da campanha, o logótipo e o fundo da própria organização", async () => {
    const { campaign, theme } = await createCampaign(a);
    const logo = await media(a, "logo");
    const foreignBackground = await media(b, "fundo");
    await prisma.campaignTheme.update({
      where: { id: theme.id },
      data: { logoMediaId: logo.id, backgroundImageMediaId: foreignBackground.id },
    });

    const element = await renderPlay(campaign.slug);

    const shell = findProps<{ theme: PublicThemeSource; backgroundImageUrl?: string }>(element, "theme");
    expect(shell?.theme).toMatchObject({ primaryColor: "#8C1D18", backgroundColor: "#FFF6D9", borderRadiusPx: 20 });
    // A imagem de outra organização não é usada.
    expect(shell?.backgroundImageUrl).toBeUndefined();
    const logoImage = findProps<{ src: string; alt: string }>(element, "src");
    expect(logoImage).toMatchObject({ src: logo.url, alt: "Marca Exemplo" });
  });

  it("o logótipo de um brand kit leva o nome da marca, ou o texto alternativo gravado", async () => {
    const { campaign, theme } = await createCampaign(a);
    // Sem texto alternativo gravado (como sai hoje do upload).
    const logo = await media(a, "logo-kit");
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: a.id } });
    const kit = await prisma.campaignTheme.create({
      data: { organizationId: a.id, name: "Toyota", isBrandKit: true, logoMediaId: logo.id },
    });
    await prisma.campaignTheme.update({ where: { id: theme.id }, data: { logoMediaId: logo.id, sourceBrandKitId: kit.id } });
    const alt = async () => findProps<{ src: string; alt: string }>(await renderPlay(campaign.slug), "src")?.alt;

    // A campanha é da Toyota, feita pela organização: não o nome desta.
    expect(await alt()).toBe("Toyota");
    // O kit mudou de logótipo: este já não é o da marca do kit.
    await prisma.campaignTheme.update({ where: { id: kit.id }, data: { logoMediaId: null } });
    expect(await alt()).toBe(organization.name);
    await prisma.mediaAsset.update({ where: { id: logo.id }, data: { altText: "Toyota Caetano Portugal" } });
    expect(await alt()).toBe("Toyota Caetano Portugal");
  });

  it("o jogo recebe o texto legal, os links legais e o contacto de privacidade", async () => {
    await prisma.organization.update({ where: { id: a.id }, data: { privacyContactEmail: "privacidade@marca.pt" } });
    const { campaign } = await createCampaign(a);

    const flow = findProps<PublicGameFlowProps>(await renderPlay(campaign.slug), "legal");

    expect(flow?.legal).toEqual({
      legalText: "Responsável: Marca Exemplo, Lda.",
      links: [
        { key: "privacyPolicyUrl", label: "Política de privacidade", url: "https://marca.pt/privacidade" },
        { key: "termsUrl", label: "Termos e condições", url: "https://marca.pt/termos" },
      ],
      privacyContactEmail: "privacidade@marca.pt",
    });
  });

  it("o favicon do tema vai para os metadados, só se for da organização", async () => {
    const { campaign, theme } = await createCampaign(a);
    const favicon = await media(a, "favicon");
    await prisma.campaignTheme.update({ where: { id: theme.id }, data: { faviconMediaId: favicon.id } });
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: campaign.slug }) });
    expect(metadata.icons).toEqual({ icon: favicon.url, shortcut: favicon.url });

    const foreign = await media(b, "favicon");
    await prisma.campaignTheme.update({ where: { id: theme.id }, data: { faviconMediaId: foreign.id } });
    const withForeign = await generateMetadata({ params: Promise.resolve({ slug: campaign.slug }) });
    expect(withForeign.icons).toBeUndefined();
  });
});

describe("links legais no editor", () => {
  it("o tema da campanha grava os links válidos, recusa o javascript: e apaga o vazio", async () => {
    const { campaign, theme } = await createCampaign(a);
    state.current = a.contexts.EDITOR;

    const result = await updateCampaignThemeAction(
      IDLE,
      form({
        campaignId: campaign.id,
        privacyPolicyUrl: "https://marca.pt/nova-privacidade",
        termsUrl: "",
        cookiesUrl: "javascript:alert(1)",
      }),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { cookiesUrl: "Política de cookies: tem de começar por https:// ou http://." },
    });
    const saved = await prisma.campaignTheme.findUniqueOrThrow({ where: { id: theme.id } });
    expect(saved.legalLinks).toEqual({
      privacyPolicyUrl: "https://marca.pt/nova-privacidade",
      termsUrl: null,
      cookiesUrl: null,
    });
    // As cores não vieram no envio e ficam.
    expect(saved.primaryColor).toBe("#8C1D18");
  });

  it("um envio sem os links não os apaga", async () => {
    const { campaign, theme } = await createCampaign(a);
    state.current = a.contexts.EDITOR;

    expect((await updateCampaignThemeAction(IDLE, form({ campaignId: campaign.id, primaryColor: "#002E5D" }))).status).toBe(
      "success",
    );
    const saved = await prisma.campaignTheme.findUniqueOrThrow({ where: { id: theme.id } });
    expect(saved.legalLinks).toEqual({
      privacyPolicyUrl: "https://marca.pt/privacidade",
      termsUrl: "https://marca.pt/termos",
    });
  });

  it("os brand kits guardam os links legais, que as campanhas novas copiam", async () => {
    const kit = await prisma.campaignTheme.create({ data: { organizationId: a.id, name: "Kit", isBrandKit: true } });
    state.current = a.contexts.ORG_ADMIN;

    const result = await updateBrandKitAction(
      IDLE,
      form({ kitId: kit.id, name: "Kit", privacyPolicyUrl: "https://marca.pt/p" }),
    );

    expect(result.status).toBe("success");
    const saved = await prisma.campaignTheme.findUniqueOrThrow({ where: { id: kit.id } });
    expect(saved.legalLinks).toEqual({ privacyPolicyUrl: "https://marca.pt/p", termsUrl: null, cookiesUrl: null });
  });
});

describe("aviso de privacidade numa campanha publicada", () => {
  /** Uma campanha publicada cujo único aviso é `notice` (ou nenhum). */
  async function withOnlyNotice(notice: "legalText" | "privacyPolicyUrl" | null, status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
    const created = await createCampaign(a, { legalText: notice === "legalText" ? "Responsável: Marca, Lda." : null });
    await prisma.campaign.update({ where: { id: created.campaign.id }, data: { status } });
    await prisma.campaignTheme.update({
      where: { id: created.theme.id },
      data: {
        legalLinks:
          notice === "privacyPolicyUrl"
            ? { privacyPolicyUrl: "https://marca.pt/privacidade", termsUrl: "https://marca.pt/termos" }
            : { termsUrl: "https://marca.pt/termos" },
      },
    });
    state.current = a.contexts.EDITOR;
    return created;
  }

  /** Formulário que ainda não pede nada: sem campos nem consentimentos. */
  async function emptyForm(campaignId: string, position: "BEFORE_GAME" | "NONE" = "BEFORE_GAME") {
    const leadForm = await prisma.leadForm.findUniqueOrThrow({ where: { campaignId } });
    await prisma.leadFormField.deleteMany({ where: { leadFormId: leadForm.id } });
    await prisma.consentDefinition.deleteMany({ where: { leadFormId: leadForm.id } });
    await prisma.leadForm.update({ where: { id: leadForm.id }, data: { position } });
    return leadForm;
  }

  it("não apaga o texto legal se for o único aviso; o resto do envio grava-se", async () => {
    const { campaign } = await withOnlyNotice("legalText");

    const result = await updateStartScreenAction(IDLE, form({ campaignId: campaign.id, legalText: "", startTitle: "Novo título" }));

    expect(result).toMatchObject({ status: "error", fieldErrors: { legalText: LIVE_PRIVACY_NOTICE_MESSAGE } });
    const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(saved.legalText).toBe("Responsável: Marca, Lda.");
    expect(saved.startTitle).toBe("Novo título");
  });

  it("com a política de privacidade, o texto legal apaga-se; num rascunho também", async () => {
    const live = await withOnlyNotice("privacyPolicyUrl");
    await prisma.campaign.update({ where: { id: live.campaign.id }, data: { legalText: "Texto" } });
    expect((await updateStartScreenAction(IDLE, form({ campaignId: live.campaign.id, legalText: "" }))).status).toBe("success");

    const draft = await withOnlyNotice("legalText", "DRAFT");
    expect((await updateStartScreenAction(IDLE, form({ campaignId: draft.campaign.id, legalText: "" }))).status).toBe("success");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: draft.campaign.id } })).legalText).toBeNull();
  });

  it("não tira a política de privacidade se for o único aviso; as cores gravam-se", async () => {
    const { campaign, theme } = await withOnlyNotice("privacyPolicyUrl");

    const result = await updateCampaignThemeAction(
      IDLE,
      form({ campaignId: campaign.id, privacyPolicyUrl: "", termsUrl: "", primaryColor: "#002E5D" }),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { privacyPolicyUrl: LIVE_PRIVACY_NOTICE_MESSAGE } });
    const saved = await prisma.campaignTheme.findUniqueOrThrow({ where: { id: theme.id } });
    expect(saved.legalLinks).toEqual({ privacyPolicyUrl: "https://marca.pt/privacidade", termsUrl: null, cookiesUrl: null });
    expect(saved.primaryColor).toBe("#002E5D");
  });

  it("aplicar um brand kit sem política de privacidade mantém os links da campanha", async () => {
    const { campaign, theme } = await withOnlyNotice("privacyPolicyUrl");
    const kit = await prisma.campaignTheme.create({
      data: { organizationId: a.id, name: "Kit", isBrandKit: true, primaryColor: "#49B489", legalLinks: { termsUrl: "https://kit.pt/t" } },
    });

    const result = await applyBrandKitAction(IDLE, form({ campaignId: campaign.id, brandKitId: kit.id }));

    expect(result).toMatchObject({ status: "success", message: expect.stringContaining("Os links legais da campanha ficaram") });
    const saved = await prisma.campaignTheme.findUniqueOrThrow({ where: { id: theme.id } });
    expect(saved.primaryColor).toBe("#49B489");
    expect(saved.legalLinks).toEqual({ privacyPolicyUrl: "https://marca.pt/privacidade", termsUrl: "https://marca.pt/termos" });
  });

  it("sem aviso, um formulário que não pedia nada não passa a pedir dados", async () => {
    const { campaign } = await withOnlyNotice(null);
    const leadForm = await emptyForm(campaign.id);

    expect(await addLeadFieldAction(IDLE, form({ campaignId: campaign.id, type: "EMAIL", label: "E-mail" }))).toMatchObject({
      status: "error",
      message: LIVE_PRIVACY_NOTICE_MESSAGE,
    });
    expect(await addConsentAction(IDLE, form({ campaignId: campaign.id, text: "Aceito o regulamento" }))).toMatchObject({
      status: "error",
      message: LIVE_PRIVACY_NOTICE_MESSAGE,
    });
    expect(await prisma.leadFormField.count({ where: { leadFormId: leadForm.id } })).toBe(0);
    expect(await prisma.consentDefinition.count({ where: { leadFormId: leadForm.id } })).toBe(0);

    // Um campo oculto não se mostra ao participante: pode-se.
    expect((await addLeadFieldAction(IDLE, form({ campaignId: campaign.id, type: "HIDDEN", label: "Origem" }))).status).toBe(
      "success",
    );
  });

  it("sem aviso, não sai de «Sem formulário» com campos que pedem dados", async () => {
    const { campaign } = await withOnlyNotice(null);
    const leadForm = await prisma.leadForm.findUniqueOrThrow({ where: { campaignId: campaign.id } });
    await prisma.leadForm.update({ where: { id: leadForm.id }, data: { position: "NONE" } });

    const result = await updateLeadFormSettingsAction(
      IDLE,
      form({ campaignId: campaign.id, position: "BEFORE_GAME", honeypotEnabled: "on" }),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { position: LIVE_PRIVACY_NOTICE_MESSAGE } });
    const saved = await prisma.leadForm.findUniqueOrThrow({ where: { id: leadForm.id } });
    expect(saved.position).toBe("NONE");
    expect(saved.honeypotEnabled).toBe(true);
  });
});

describe("aviso de privacidade: edições ao mesmo tempo e publicação", () => {
  it("duas edições ao mesmo tempo, cada uma permitida sozinha, não tiram juntas o aviso", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { campaign, theme } = await createCampaign(a);
      state.current = a.contexts.EDITOR;
      const results = await Promise.all([
        updateStartScreenAction(IDLE, form({ campaignId: campaign.id, legalText: "" })),
        updateCampaignThemeAction(IDLE, form({ campaignId: campaign.id, privacyPolicyUrl: "", termsUrl: "https://marca.pt/termos" })),
      ]);
      // Uma das duas grava; a outra vê o que a primeira gravou e recusa.
      expect(results.map((result) => result.status).sort()).toEqual(["error", "success"]);
      const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id }, select: { legalText: true } });
      const links = (await prisma.campaignTheme.findUniqueOrThrow({ where: { id: theme.id } })).legalLinks as {
        privacyPolicyUrl?: string | null;
      } | null;
      expect(Boolean(saved.legalText) || Boolean(links?.privacyPolicyUrl)).toBe(true);
    }
  });

  it("publicar volta a verificar o aviso: uma edição durante o upload do QR code não passa", async () => {
    const { campaign, theme } = await createCampaign(a, { legalText: null });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    const memoryConfig = await prisma.memoryGameConfig.findUniqueOrThrow({ where: { campaignId: campaign.id } });
    await prisma.memoryCardPair.createMany({
      data: [0, 1].map((order) => ({
        memoryGameConfigId: memoryConfig.id,
        order,
        kind: "TEXT_TEXT" as const,
        cardAText: `P${order}`,
        cardBText: `P${order}`,
      })),
    });
    state.current = a.contexts.ORG_ADMIN;
    // Enquanto o QR code sobe, alguém tira a política de privacidade (o
    // único aviso) — a campanha ainda é rascunho, a guarda do editor não se
    // aplica.
    qr.duringUpload = async () => {
      await prisma.campaignTheme.update({ where: { id: theme.id }, data: { legalLinks: { termsUrl: "https://marca.pt/t" } } });
    };
    try {
      await expect(publishCampaignAction(form({ campaignId: campaign.id }))).rejects.toMatchObject({
        digest: expect.stringContaining("error=readiness"),
      });
    } finally {
      qr.duringUpload = null;
    }
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("DRAFT");
  });
});

describe("campos ocultos no editor", () => {
  it("grava o valor predefinido e nunca fica obrigatório", async () => {
    const { campaign } = await createCampaign(a);
    const leadForm = await prisma.leadForm.findUniqueOrThrow({ where: { campaignId: campaign.id } });
    const hidden = await prisma.leadFormField.create({
      data: { leadFormId: leadForm.id, type: "HIDDEN", internalKey: "origem", label: "Origem", order: 9 },
    });
    state.current = a.contexts.EDITOR;

    const result = await updateLeadFieldAction(
      IDLE,
      form({ campaignId: campaign.id, fieldId: hidden.id, defaultValue: "newsletter", required: "on" }),
    );

    expect(result.status).toBe("success");
    expect(await prisma.leadFormField.findUniqueOrThrow({ where: { id: hidden.id } })).toMatchObject({
      defaultValue: "newsletter",
      required: false,
    });
  });
});

describe("consentimento de marketing já respondido", () => {
  it("respostas de teste não prendem o tipo nem impedem de o remover", async () => {
    const { campaign, version, consents } = await createCampaign(a);
    const [, marketing] = consents;
    state.current = a.contexts.EDITOR;
    const testPlay = await prisma.participation.create({
      data: { campaignId: campaign.id, campaignVersionId: version.id, idempotencyKey: randomUUID(), isTest: true },
    });
    await prisma.consentRecord.create({
      data: { participationId: testPlay.id, consentDefinitionId: marketing.id, status: "GRANTED", text: marketing.text, version: 3 },
    });

    // Só respostas de teste: o tipo muda, e as respostas de teste saem.
    expect(
      (await updateConsentAction(IDLE, form({ campaignId: campaign.id, consentId: marketing.id, isMarketing: "" }))).status,
    ).toBe("success");
    expect(await prisma.consentRecord.count({ where: { consentDefinitionId: marketing.id } })).toBe(0);

    await prisma.consentRecord.create({
      data: { participationId: testPlay.id, consentDefinitionId: marketing.id, status: "GRANTED", text: marketing.text, version: 3 },
    });
    expect((await removeConsentAction(IDLE, form({ campaignId: campaign.id, consentId: marketing.id }))).status).toBe(
      "success",
    );
    expect(await prisma.consentDefinition.findUnique({ where: { id: marketing.id } })).toBeNull();
  });

  it("não muda de tipo depois de haver respostas; antes, muda", async () => {
    const { campaign, version, consents } = await createCampaign(a);
    const [regulation, marketing] = consents;
    state.current = a.contexts.EDITOR;

    // Sem respostas: o regulamento pode passar a não obrigatório.
    expect(
      (await updateConsentAction(IDLE, form({ campaignId: campaign.id, consentId: regulation.id, required: "" }))).status,
    ).toBe("success");

    const participation = await prisma.participation.create({
      data: { campaignId: campaign.id, campaignVersionId: version.id, idempotencyKey: randomUUID() },
    });
    await prisma.consentRecord.create({
      data: { participationId: participation.id, consentDefinitionId: marketing.id, status: "DECLINED", text: marketing.text, version: 3 },
    });

    // Com respostas: deixar de ser de marketing mudava o que elas querem dizer.
    const result = await updateConsentAction(IDLE, form({ campaignId: campaign.id, consentId: marketing.id, isMarketing: "" }));
    expect(result).toMatchObject({ status: "error", fieldErrors: { isMarketing: CONSENT_MARKETING_LOCKED_MESSAGE } });
    expect((await prisma.consentDefinition.findUniqueOrThrow({ where: { id: marketing.id } })).isMarketing).toBe(true);

    // O texto continua a poder mudar (versão nova).
    const edited = await updateConsentAction(
      IDLE,
      form({ campaignId: campaign.id, consentId: marketing.id, text: "Aceito receber novidades por SMS" }),
    );
    expect(edited.status).toBe("success");
    expect(await prisma.consentDefinition.findUniqueOrThrow({ where: { id: marketing.id } })).toMatchObject({
      isMarketing: true,
      version: 4,
    });
  });
});

describe("contacto de privacidade da organização", () => {
  it("o administrador grava-o normalizado; um e-mail inválido volta com erro; vazio apaga", async () => {
    state.current = a.contexts.ORG_ADMIN;

    expect(
      (await updatePrivacySettingsAction(IDLE, form({ privacyContactEmail: " Privacidade@Marca.PT " }))).status,
    ).toBe("success");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).privacyContactEmail).toBe(
      "privacidade@marca.pt",
    );

    const invalid = await updatePrivacySettingsAction(IDLE, form({ privacyContactEmail: "não é e-mail" }));
    expect(invalid).toMatchObject({
      status: "error",
      fieldErrors: { privacyContactEmail: "Contacto de privacidade: e-mail inválido." },
    });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).privacyContactEmail).toBe(
      "privacidade@marca.pt",
    );

    expect((await updatePrivacySettingsAction(IDLE, form({ privacyContactEmail: "" }))).status).toBe("success");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).privacyContactEmail).toBeNull();

    // O e-mail não vai para a auditoria.
    const audits = await prisma.auditLog.findMany({ where: { organizationId: a.id, entityType: "Organization" } });
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits.map((audit) => audit.metadata))).not.toContain("marca.pt");
  });

  it("um editor não o muda, e cada organização só muda o seu", async () => {
    state.current = a.contexts.EDITOR;
    expect(await updatePrivacySettingsAction(IDLE, form({ privacyContactEmail: "x@marca.pt" }))).toMatchObject({
      status: "error",
      message: "Não tem permissão para fazer esta alteração.",
    });

    state.current = b.contexts.ORG_ADMIN;
    expect((await updatePrivacySettingsAction(IDLE, form({ privacyContactEmail: "b@outra.pt" }))).status).toBe("success");
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: a.id } })).privacyContactEmail).toBeNull();
  });
});

describe("consentimentos nas leads", () => {
  async function leadsWithConsents() {
    const { campaign, version, consents } = await createCampaign(a);
    const [regulation, marketing] = consents;
    const participation = async (email: string, marketingStatus: "GRANTED" | "DECLINED" | null) => {
      const created = await prisma.participation.create({
        data: {
          campaignId: campaign.id,
          campaignVersionId: version.id,
          idempotencyKey: randomUUID(),
          email,
          leadFormResponse: { email },
        },
      });
      if (marketingStatus) {
        await prisma.consentRecord.createMany({
          data: [
            { participationId: created.id, consentDefinitionId: regulation.id, status: "GRANTED", text: regulation.text, version: 1 },
            {
              participationId: created.id,
              consentDefinitionId: marketing.id,
              status: marketingStatus,
              text: marketing.text,
              version: 3,
            },
          ],
        });
      }
      return created;
    };
    const granted = await participation("sim@example.pt", "GRANTED");
    const declined = await participation("nao@example.pt", "DECLINED");
    const none = await participation("sem@example.pt", null);
    return { campaign, granted, declined, none };
  }

  const range = () => resolveDateRange({ period: "all" });

  it("a lista filtra por consentimento de marketing e mostra o estado", async () => {
    const { campaign, granted, declined, none } = await leadsWithConsents();

    const all = await listLeads(a.id, range(), { campaignId: campaign.id });
    expect(all.total).toBe(3);
    const withMarketing = await listLeads(a.id, range(), { campaignId: campaign.id, marketingConsent: "granted" });
    expect(withMarketing.items.map((item) => item.id)).toEqual([granted.id]);
    const without = await listLeads(a.id, range(), { campaignId: campaign.id, marketingConsent: "not_granted" });
    expect(without.items.map((item) => item.id).sort()).toEqual([declined.id, none.id].sort());
  });

  it("a exportação respeita o filtro e traz uma coluna por consentimento", async () => {
    const { campaign } = await leadsWithConsents();
    state.current = a.contexts.ORG_ADMIN;

    const response = await exportRoute.GET(
      new Request(`http://localhost:3000/api/leads/export?period=all&campaignId=${campaign.id}&marketingConsent=granted`),
    );
    expect(response.status).toBe(200);
    const [header, ...lines] = (await response.text()).split("\n");
    expect(header.endsWith(
      ",Consentimento de marketing,Consentimentos,Consentimento: Aceito o regulamento (v1),Consentimento: Aceito receber novidades (v3),Anonimizada em",
    )).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sim@example.pt");
    expect(lines[0].endsWith(",Aceite,Aceite,")).toBe(true);
    expect(lines[0]).toContain(",Concedido,");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: a.id, action: "EXPORT", result: "SUCCESS", metadata: { path: ["stage"], equals: "completed" } },
    });
    expect(audit.metadata).toMatchObject({ count: 1, filters: { marketingConsent: "granted" } });
  });

  it("sem campanha escolhida, só o resumo (as campanhas têm consentimentos diferentes)", async () => {
    await leadsWithConsents();
    state.current = a.contexts.ORG_ADMIN;

    const response = await exportRoute.GET(new Request("http://localhost:3000/api/leads/export?period=all"));
    const header = (await response.text()).split("\n")[0];
    expect(header.endsWith(",Consentimento de marketing,Consentimentos,Anonimizada em")).toBe(true);
  });
});
