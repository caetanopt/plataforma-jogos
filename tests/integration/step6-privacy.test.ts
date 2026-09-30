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

const { IDLE } = await import("@/lib/forms/action-result");
const { updateCampaignThemeAction } = await import("@/features/campaigns/steps/brand-actions");
const { updateBrandKitAction } = await import("@/features/brand/actions");
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
      ",Consentimento de marketing,Consentimentos,Consentimento: Aceito o regulamento (v1),Consentimento: Aceito receber novidades (v3)",
    )).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("sim@example.pt");
    expect(lines[0].endsWith(",Aceite,Aceite")).toBe(true);
    expect(lines[0]).toContain(",Concedido,");

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: a.id, action: "EXPORT", result: "SUCCESS" },
    });
    expect(audit.metadata).toMatchObject({ count: 1, filters: { marketingConsent: "granted" } });
  });

  it("sem campanha escolhida, só o resumo (as campanhas têm consentimentos diferentes)", async () => {
    await leadsWithConsents();
    state.current = a.contexts.ORG_ADMIN;

    const response = await exportRoute.GET(new Request("http://localhost:3000/api/leads/export?period=all"));
    const header = (await response.text()).split("\n")[0];
    expect(header.endsWith(",Consentimento de marketing,Consentimentos")).toBe(true);
  });
});
