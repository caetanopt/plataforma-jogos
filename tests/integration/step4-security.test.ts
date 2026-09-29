import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { Membership, MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Autorização, isolamento multi-tenant e dados fora dos logs (passo 4 da
 * auditoria). As rotas e as ações correm a sério contra a base de dados;
 * substitui-se só o que depende de um pedido HTTP ou de serviços externos:
 * a sessão, o cache do Next, o Redis, o storage e o envio de e-mail.
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
vi.mock("@/server/auth", () => ({ auth: async () => null, signIn: async () => {} }));
// O next-auth não resolve `next/server` fora do runtime do Next.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 10 }),
}));
vi.mock("@/lib/security/request-ip", () => ({ getRequestIp: async () => null }));

const storage = vi.hoisted(() => ({
  head: null as null | { contentLength: number; contentType: string },
}));
vi.mock("@/server/storage/client", () => ({
  s3: { send: async () => ({}) },
  MEDIA_BUCKET: "teste",
  publicUrlForKey: (key: string) => `https://cdn.test/${key}`,
  headObject: async () => storage.head,
  StorageError: class StorageError extends Error {},
  uploadBuffer: async () => "https://cdn.test/x",
}));

const mail = vi.hoisted(() => ({ fail: false }));
vi.mock("@/server/mail/mailer", () => {
  class MailDeliveryError extends Error {}
  return {
    MailDeliveryError,
    sendMail: async () => {
      if (mail.fail) throw new MailDeliveryError("Falha no envio de e-mail (EENVELOPE 550)");
    },
  };
});

const { requirePagePermission } = await import("@/server/auth/page-guard");
const exportRoute = await import("@/app/api/leads/export/route");
const presignRoute = await import("@/app/api/uploads/presign/route");
const confirmRoute = await import("@/app/api/uploads/confirm/route");
const logoutRoute = await import("@/app/api/logout/route");
const { updateScheduleAction } = await import("@/features/campaigns/steps/schedule-actions");
const { updateStartScreenAction } = await import("@/features/campaigns/steps/start-screen-actions");
const { recordAnalyticsEventAction } = await import("@/features/play/actions");
const { inviteUserAction } = await import("@/features/users/actions");
const { resetPasswordAction } = await import("@/features/auth/actions");
const { uploadKeyFor } = await import("@/lib/security/upload-keys");

interface Org {
  id: string;
  workspaceId: string;
  contexts: Record<MembershipRole | "EDITOR_PUBLISHER", OrgContext>;
  cleanup: () => Promise<void>;
}

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `S4 ${suffix}`, slug: `s4-${suffix}` } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "S4", slug: `s4-${suffix}` },
  });

  const contexts = {} as Org["contexts"];
  const userIds: string[] = [];
  const roles: Array<[keyof Org["contexts"], MembershipRole, boolean]> = [
    ["ORG_ADMIN", "ORG_ADMIN", false],
    ["EDITOR", "EDITOR", false],
    ["EDITOR_PUBLISHER", "EDITOR", true],
    ["ANALYST", "ANALYST", false],
    ["VIEWER", "VIEWER", false],
  ];
  for (const [key, role, canPublish] of roles) {
    const user = await prisma.user.create({
      data: { name: key, email: `s4-${key.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
    });
    userIds.push(user.id);
    const membership: Membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: organization.id, role, canPublish },
    });
    contexts[key] = {
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
    contexts,
    cleanup: async () => {
      await prisma.analyticsEvent.deleteMany({ where: { campaign: { organizationId: organization.id } } });
      await prisma.campaign.deleteMany({ where: { organizationId: organization.id } });
      await prisma.mediaAsset.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.membership.deleteMany({ where: { organizationId: organization.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.workspace.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    },
  };
}

async function createCampaign(org: Org, status: "DRAFT" | "PUBLISHED", extra: Record<string, unknown> = {}) {
  return prisma.campaign.create({
    data: {
      organizationId: org.id,
      workspaceId: org.workspaceId,
      type: "QUIZ",
      internalName: `Campanha ${randomUUID().slice(0, 6)}`,
      ownerId: org.contexts.ORG_ADMIN.userId,
      slug: `s4-${randomUUID()}`,
      status,
      ...extra,
    },
  });
}

async function createMedia(org: Org) {
  return prisma.mediaAsset.create({
    data: {
      organizationId: org.id,
      uploadedById: org.contexts.ORG_ADMIN.userId,
      kind: "IMAGE",
      storageKey: `uploads/${org.id}/${randomUUID()}.png`,
      url: "https://cdn.test/x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    },
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function redirectTarget(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.startsWith("NEXT_REDIRECT") ? digest.split(";")[2] ?? "" : `erro: ${String(error)}`;
  }
}

let org: Org;
let other: Org;

beforeAll(async () => {
  org = await createOrg("a");
  other = await createOrg("b");
});

afterAll(async () => {
  await org.cleanup();
  await other.cleanup();
  await prisma.$disconnect();
});

beforeEach(() => {
  storage.head = null;
  mail.fail = false;
});

afterEach(() => {
  state.current = null;
});

describe("páginas: cada uma verifica a sua permissão", () => {
  it("um Visualizador que peça o editor vai para /sem-permissao", async () => {
    state.current = org.contexts.VIEWER;
    expect(await redirectTarget(requirePagePermission("campaign:edit"))).toBe("/sem-permissao");
  });

  it("o Visualizador já não vê leads (§3); o Analista vê", async () => {
    state.current = org.contexts.VIEWER;
    expect(await redirectTarget(requirePagePermission("leads:view"))).toBe("/sem-permissao");

    state.current = org.contexts.ANALYST;
    expect((await requirePagePermission("leads:view")).userId).toBe(org.contexts.ANALYST.userId);
  });
});

describe("rotas da API: 401/403 em JSON", () => {
  it("exportação de leads: sem sessão 401, sem permissão 403 (e fica na auditoria)", async () => {
    const request = () => new Request("http://localhost:3000/api/leads/export?period=all");

    state.current = null;
    expect((await exportRoute.GET(request())).status).toBe(401);

    state.current = org.contexts.VIEWER;
    const denied = await exportRoute.GET(request());
    expect(denied.status).toBe(403);
    const audit = await prisma.auditLog.count({
      where: { organizationId: org.id, action: "EXPORT", result: "FAILURE", userId: org.contexts.VIEWER.userId },
    });
    expect(audit).toBe(1);

    state.current = org.contexts.ORG_ADMIN;
    const allowed = await exportRoute.GET(request());
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toContain("text/csv");
  });

  it("uploads: o Visualizador e o Analista não obtêm URLs de escrita", async () => {
    const body = { contentType: "image/png", sizeBytes: 100 };

    state.current = null;
    expect((await presignRoute.POST(jsonRequest("/api/uploads/presign", body))).status).toBe(401);
    for (const role of ["VIEWER", "ANALYST"] as const) {
      state.current = org.contexts[role];
      expect((await presignRoute.POST(jsonRequest("/api/uploads/presign", body))).status).toBe(403);
    }
  });
});

describe("confirmação de uploads", () => {
  it("recusa uma chave de outra organização", async () => {
    state.current = org.contexts.EDITOR;
    storage.head = { contentLength: 100, contentType: "image/png" };
    const key = uploadKeyFor(other.id, "png");

    const response = await confirmRoute.POST(
      jsonRequest("/api/uploads/confirm", { key, mimeType: "image/png", sizeBytes: 100 }),
    );

    expect(response.status).toBe(400);
  });

  it("recusa quando o objeto não existe ou difere do declarado", async () => {
    state.current = org.contexts.EDITOR;
    const key = uploadKeyFor(org.id, "png");
    const confirm = () =>
      confirmRoute.POST(jsonRequest("/api/uploads/confirm", { key, mimeType: "image/png", sizeBytes: 100 }));

    storage.head = null;
    expect((await confirm()).status).toBe(400);

    storage.head = { contentLength: 5_000_000, contentType: "image/png" };
    expect((await confirm()).status).toBe(400);

    storage.head = { contentLength: 100, contentType: "image/svg+xml" };
    expect((await confirm()).status).toBe(400);
  });

  it("deriva o URL no servidor (ignora o que o browser manda) e não duplica ao repetir", async () => {
    state.current = org.contexts.EDITOR;
    storage.head = { contentLength: 100, contentType: "image/png" };
    const key = uploadKeyFor(org.id, "png");
    const body = { key, mimeType: "image/png", sizeBytes: 100, publicUrl: "https://tracker.example/pixel.gif" };

    const first = await confirmRoute.POST(jsonRequest("/api/uploads/confirm", body));
    const second = await confirmRoute.POST(jsonRequest("/api/uploads/confirm", body));

    expect(first.status).toBe(200);
    const created = (await first.json()) as { id: string; url: string };
    expect(created.url).toBe(`https://cdn.test/${key}`);
    expect(((await second.json()) as { id: string }).id).toBe(created.id);
  });
});

describe("agenda de uma campanha publicada", () => {
  const newEnd = "2031-01-01T10:00";

  it("um Editor sem permissão de publicar não muda as datas, mas grava as mensagens", async () => {
    const endAt = new Date("2030-06-01T10:00:00Z");
    const campaign = await createCampaign(org, "PUBLISHED", { scheduleEndAt: endAt });
    state.current = org.contexts.EDITOR;

    await updateScheduleAction(
      form({ campaignId: campaign.id, scheduleEndAt: newEnd, scheduleAfterMessage: "Obrigado!" }),
    );

    const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(saved.scheduleEndAt?.toISOString()).toBe(endAt.toISOString());
    expect(saved.scheduleAfterMessage).toBe("Obrigado!");
  });

  it("com permissão de publicar, as datas mudam e a auditoria regista antes/depois", async () => {
    const campaign = await createCampaign(org, "PUBLISHED", { scheduleEndAt: new Date("2030-06-01T10:00:00Z") });
    state.current = org.contexts.EDITOR_PUBLISHER;

    await updateScheduleAction(form({ campaignId: campaign.id, scheduleEndAt: newEnd }));

    const saved = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(saved.scheduleEndAt?.getUTCFullYear()).toBe(2031);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: org.id, entityId: campaign.id, action: "UPDATE" },
    });
    expect(audit.metadata).toMatchObject({ endBefore: "2030-06-01T10:00:00.000Z" });
  });
});

describe("media só da própria organização", () => {
  it("o ecrã inicial recusa media de outra organização e aceita a sua", async () => {
    const campaign = await createCampaign(org, "DRAFT");
    const foreign = await createMedia(other);
    const own = await createMedia(org);
    state.current = org.contexts.EDITOR;

    await updateStartScreenAction(form({ campaignId: campaign.id, startTitle: "Olá", startMediaId: foreign.id }));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).startMediaId).toBeNull();

    await updateStartScreenAction(form({ campaignId: campaign.id, startTitle: "Olá", startMediaId: own.id }));
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).startMediaId).toBe(own.id);
  });
});

describe("eventos públicos de analytics", () => {
  it("ignora campanhas que não estão no ar e decide o modo de teste no servidor", async () => {
    const draft = await createCampaign(org, "DRAFT");
    const live = await createCampaign(org, "PUBLISHED");

    await recordAnalyticsEventAction(draft.id, "CAMPAIGN_VIEWED", false, randomUUID());
    await recordAnalyticsEventAction(live.id, "CAMPAIGN_VIEWED", true, randomUUID());
    await recordAnalyticsEventAction("nao-existe", "CAMPAIGN_VIEWED", false, randomUUID());

    expect(await prisma.analyticsEvent.count({ where: { campaignId: draft.id } })).toBe(0);
    const events = await prisma.analyticsEvent.findMany({ where: { campaignId: live.id } });
    expect(events).toHaveLength(1);
    // Visitante anónimo: pedir modo de teste não chega para o evento contar como teste.
    expect(events[0]?.isTest).toBe(false);
  });
});

describe("convite com falha no envio do e-mail", () => {
  it("desfaz o que criou, para se poder convidar outra vez", async () => {
    state.current = org.contexts.ORG_ADMIN;
    mail.fail = true;
    const email = `convidado-${randomUUID().slice(0, 8)}@example.com`;

    const target = await redirectTarget(
      inviteUserAction(form({ name: "Convidado", email, role: "EDITOR" })),
    );

    expect(target).toBe("/users?error=invite_email_failed");
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });
});

describe("logout", () => {
  it("apaga os cookies __Secure-/__Host- com o atributo Secure", async () => {
    const response = await logoutRoute.POST(
      new Request("https://app.example/api/logout", {
        method: "POST",
        headers: {
          origin: "https://app.example",
          cookie: "__Secure-authjs.session-token=abc; __Host-authjs.csrf-token=def; outro=1",
        },
      }),
    );

    expect(response.status).toBe(303);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Secure-authjs.session-token="));
    const csrf = cookies.find((c) => c.startsWith("__Host-authjs.csrf-token="));
    expect(session).toMatch(/Secure/i);
    expect(csrf).toMatch(/Secure/i);
    expect(cookies.some((c) => c.startsWith("outro="))).toBe(false);
  });

  it("recusa um pedido de outra origem", async () => {
    const response = await logoutRoute.POST(
      new Request("https://app.example/api/logout", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(response.status).toBe(403);
  });
});

describe("reposição de password", () => {
  it("um erro de validação volta como estado — sem redirect com o token no URL", async () => {
    const result = await resetPasswordAction(
      { error: null },
      form({ token: "token-secreto", password: "curta", confirmPassword: "curta" }),
    );
    expect(result).toEqual({ error: "validation" });
  });
});
