import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { Campaign, Membership, MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";
import type { ActionResult } from "@/lib/forms/action-result";

/**
 * Gravação das etapas Informações, Agenda e Regras (passo 5a): um campo
 * inválido já não deita fora os outros, a resposta diz o que ficou por
 * gravar, e os campos que o formulário não envia ficam como estão.
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

const { IDLE, NOTHING_SAVED_MESSAGE, PARTIAL_SAVE_MESSAGE } = await import("@/lib/forms/action-result");
const {
  PARTICIPATION_CUSTOM_MAX_REQUIRED_MESSAGE,
  PROJECT_INFO_MESSAGES,
  SCHEDULE_ORDER_MESSAGE,
} = await import("@/lib/validation/campaign");
const { utcToZonedDateTimeLocal } = await import("@/lib/dates/timezone");
const { updateProjectInfoAction } = await import("@/features/campaigns/steps/project-info-actions");
const { updateScheduleAction } = await import("@/features/campaigns/steps/schedule-actions");
const { updateParticipationRulesAction } = await import("@/features/campaigns/steps/participation-actions");
const { LIVE_MIN_AGE_NEEDS_BIRTH_DATE_MESSAGE } = await import("@/features/publishing/age-check");

const NOT_FOUND = { digest: expect.stringContaining("404") };

interface Org {
  id: string;
  workspaceId: string;
  folderId: string;
  otherWorkspaceId: string;
  otherFolderId: string;
  admin: OrgContext;
  editor: OrgContext;
  cleanup: () => Promise<void>;
}

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `E5 ${suffix}`, slug: `e5-${suffix}` } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `e5-${suffix}` },
  });
  const otherWorkspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Outro", slug: `e5-outro-${suffix}` },
  });
  const folder = await prisma.folder.create({ data: { workspaceId: workspace.id, name: "Pasta principal" } });
  const otherFolder = await prisma.folder.create({ data: { workspaceId: otherWorkspace.id, name: "Pasta do outro" } });

  const userIds: string[] = [];
  async function member(role: MembershipRole): Promise<OrgContext> {
    const user = await prisma.user.create({
      data: { name: role, email: `e5-${role.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
    });
    userIds.push(user.id);
    const membership: Membership = await prisma.membership.create({
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

  const admin = await member("ORG_ADMIN");
  // Editor sem permissão de publicar (canPublish a false).
  const editor = await member("EDITOR");

  return {
    id: organization.id,
    workspaceId: workspace.id,
    folderId: folder.id,
    otherWorkspaceId: otherWorkspace.id,
    otherFolderId: otherFolder.id,
    admin,
    editor,
    cleanup: async () => {
      await prisma.campaign.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.membership.deleteMany({ where: { organizationId: organization.id } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.folder.deleteMany({ where: { workspace: { organizationId: organization.id } } });
      await prisma.workspace.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    },
  };
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

afterEach(() => {
  session.current = null;
});

/** Campanha com valores em todas as etapas, para ver que nada se perde. */
function createCampaign(target: Org, extra: Partial<Campaign> = {}) {
  return prisma.campaign.create({
    data: {
      organizationId: target.id,
      workspaceId: target.workspaceId,
      folderId: target.folderId,
      type: "QUIZ",
      internalName: "Nome original",
      publicTitle: "Título original",
      internalReference: "REF-1",
      tags: ["verão"],
      description: "Descrição original",
      ownerId: target.admin.userId,
      slug: `e5-${randomUUID()}`,
      startTitle: "Ecrã inicial",
      participationLimitType: "ONE_TOTAL",
      minAge: 18,
      scheduleStartAt: new Date("2030-06-01T09:00:00Z"),
      scheduleEndAt: new Date("2030-06-30T21:00:00Z"),
      scheduleBeforeMessage: "Antes",
      scheduleAfterMessage: "Depois",
      scheduleRedirectUrl: "https://antes.example",
      ...extra,
    },
  });
}

function reload(campaignId: string) {
  return prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
}

function toForm(fields: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

/** O que a página Informações envia: os valores gravados mais as alterações. */
function projectInfoForm(campaign: Campaign, changes: Record<string, string | undefined> = {}): FormData {
  return toForm({
    campaignId: campaign.id,
    internalName: campaign.internalName,
    publicTitle: campaign.publicTitle ?? "",
    internalReference: campaign.internalReference ?? "",
    workspaceId: campaign.workspaceId,
    folderId: campaign.folderId ?? "",
    tags: campaign.tags.join(", "),
    description: campaign.description ?? "",
    locale: campaign.locale,
    timezone: campaign.timezone,
    // Desativado depois de publicar: não vai no envio.
    slug: campaign.publishedAt ? undefined : campaign.slug,
    ...changes,
  });
}

/** O que a página Agenda envia (as datas vão desativadas quando bloqueadas). */
function scheduleForm(
  campaign: Campaign,
  changes: Record<string, string | undefined> = {},
  { datesLocked = false } = {},
): FormData {
  const local = (date: Date | null) => (date ? utcToZonedDateTimeLocal(date, campaign.timezone) : "");
  return toForm({
    campaignId: campaign.id,
    scheduleStartAt: datesLocked ? undefined : local(campaign.scheduleStartAt),
    scheduleEndAt: datesLocked ? undefined : local(campaign.scheduleEndAt),
    scheduleBeforeMessage: campaign.scheduleBeforeMessage ?? "",
    scheduleAfterMessage: campaign.scheduleAfterMessage ?? "",
    scheduleRedirectUrl: campaign.scheduleRedirectUrl ?? "",
    ...changes,
  });
}

/** O que a página Regras envia: o máximo só com "Máximo personalizado" escolhido. */
function rulesForm(type: string, customMax: string | undefined, minAge: string, campaignId: string): FormData {
  return toForm({
    campaignId,
    participationLimitType: type,
    participationCustomMax: type === "CUSTOM_MAX" ? customMax : undefined,
    minAge,
  });
}

function fieldErrorKeys(result: ActionResult): string[] {
  return result.status === "error" ? Object.keys(result.fieldErrors).sort() : [];
}

function fieldError(result: ActionResult, key: string): string | undefined {
  return result.status === "error" ? result.fieldErrors[key] : undefined;
}

describe("Informações do projeto", () => {
  it("grava os campos válidos e devolve o erro do nome interno vazio; o resto da campanha fica", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { internalName: "  ", publicTitle: "Título novo", tags: "a, b ,, c" }),
    );

    expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
    expect(fieldErrorKeys(result)).toEqual(["internalName"]);
    expect(fieldError(result, "internalName")).toBe("Nome interno: obrigatório.");
    const saved = await reload(campaign.id);
    expect(saved.internalName).toBe("Nome original");
    expect(saved.publicTitle).toBe("Título novo");
    expect(saved.tags).toEqual(["a", "b", "c"]);
    expect(saved.slug).toBe(campaign.slug);
    expect(saved.folderId).toBe(org.folderId);
    // Campos de outras etapas: intactos.
    expect(saved.startTitle).toBe("Ecrã inicial");
    expect(saved.participationLimitType).toBe("ONE_TOTAL");
    expect(saved.scheduleEndAt?.toISOString()).toBe(campaign.scheduleEndAt?.toISOString());
  });

  it("sem nada válido para gravar: não escreve nem audita", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(IDLE, toForm({ campaignId: campaign.id, internalName: "" }));

    expect(result).toMatchObject({ status: "error", message: NOTHING_SAVED_MESSAGE });
    expect((await reload(campaign.id)).updatedAt.toISOString()).toBe(campaign.updatedAt.toISOString());
    expect(await prisma.auditLog.count({ where: { entityId: campaign.id } })).toBe(0);
  });

  it("um endereço já usado por outra campanha (de qualquer organização) volta com erro; o resto grava", async () => {
    const taken = await createCampaign(other);
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { slug: taken.slug, description: "Nova descrição" }),
    );

    expect(fieldErrorKeys(result)).toEqual(["slug"]);
    expect(fieldError(result, "slug")).toBe(PROJECT_INFO_MESSAGES.slugTaken);
    const saved = await reload(campaign.id);
    expect(saved.slug).toBe(campaign.slug);
    expect(saved.description).toBe("Nova descrição");
  });

  it("normaliza o endereço novo, audita antes/depois e não corta um endereço longo que não mudou", async () => {
    const longSlug = `${"a".repeat(60)}-abc123`;
    const campaign = await createCampaign(org, { slug: `${longSlug}-${randomUUID().slice(0, 4)}` });
    session.current = org.editor;

    // A gravação automática envia sempre o endereço gravado.
    expect((await updateProjectInfoAction(IDLE, projectInfoForm(campaign, { publicTitle: "X" }))).status).toBe("success");
    expect((await reload(campaign.id)).slug).toBe(campaign.slug);

    const slug = `Campanha Verão ${randomUUID().slice(0, 6)}`;
    expect((await updateProjectInfoAction(IDLE, projectInfoForm(campaign, { slug }))).status).toBe("success");
    const saved = await reload(campaign.id);
    expect(saved.slug).toMatch(/^campanha-verao-[0-9a-f]{6}$/);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: campaign.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ step: "informacoes", slugBefore: campaign.slug, slugAfter: saved.slug });
  });

  it("um endereço sem letras nem números é recusado", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(IDLE, projectInfoForm(campaign, { slug: "!!! ---" }));

    expect(fieldError(result, "slug")).toBe(PROJECT_INFO_MESSAGES.slugEmpty);
    expect((await reload(campaign.id)).slug).toBe(campaign.slug);
  });

  it("campanha publicada: sem o campo (desativado) grava; com outro endereço recusa", async () => {
    const campaign = await createCampaign(org, { status: "PUBLISHED", publishedAt: new Date() });
    session.current = org.editor;

    const kept = await updateProjectInfoAction(IDLE, projectInfoForm(campaign, { publicTitle: "Publicada" }));
    expect(kept.status).toBe("success");

    const refused = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(await reload(campaign.id), { slug: "outro-endereco", internalReference: "REF-2" }),
    );
    expect(fieldErrorKeys(refused)).toEqual(["slug"]);
    expect(fieldError(refused, "slug")).toBe(PROJECT_INFO_MESSAGES.slugLocked);

    const saved = await reload(campaign.id);
    expect(saved.slug).toBe(campaign.slug);
    expect(saved.publicTitle).toBe("Publicada");
    expect(saved.internalReference).toBe("REF-2");
  });

  it("pasta de outro espaço de trabalho: a aplicação fica sem pasta e a resposta diz porquê", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { folderId: org.otherFolderId, internalName: "Nome novo" }),
    );

    expect(fieldErrorKeys(result)).toEqual(["folderId"]);
    expect(fieldError(result, "folderId")).toBe(PROJECT_INFO_MESSAGES.folderOutsideWorkspace);
    const saved = await reload(campaign.id);
    expect(saved.folderId).toBeNull();
    expect(saved.workspaceId).toBe(org.workspaceId);
    expect(saved.internalName).toBe("Nome novo");
  });

  it("mudar de espaço de trabalho com a pasta a acompanhar (\"Sem pasta\") grava sem erro", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const moved = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { workspaceId: org.otherWorkspaceId, folderId: "" }),
    );
    expect(moved.status).toBe("success");
    expect(await reload(campaign.id)).toMatchObject({ workspaceId: org.otherWorkspaceId, folderId: null });

    const intoFolder = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(await reload(campaign.id), { folderId: org.otherFolderId }),
    );
    expect(intoFolder.status).toBe("success");
    expect((await reload(campaign.id)).folderId).toBe(org.otherFolderId);
  });

  it("mudar só o espaço de trabalho (sem enviar a pasta) tira a aplicação da pasta do espaço anterior", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      toForm({ campaignId: campaign.id, workspaceId: org.otherWorkspaceId }),
    );

    expect(fieldError(result, "folderId")).toBe(PROJECT_INFO_MESSAGES.folderOutsideWorkspace);
    expect(await reload(campaign.id)).toMatchObject({ workspaceId: org.otherWorkspaceId, folderId: null });
  });

  it("espaço de trabalho ou pasta de outra organização são recusados", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { workspaceId: other.workspaceId, folderId: other.folderId, publicTitle: "Mantém-se" }),
    );

    expect(fieldErrorKeys(result)).toEqual(["folderId", "workspaceId"]);
    expect(fieldError(result, "workspaceId")).toBe(PROJECT_INFO_MESSAGES.workspaceNotFound);
    const saved = await reload(campaign.id);
    expect(saved.workspaceId).toBe(org.workspaceId);
    expect(saved.folderId).toBeNull();
    expect(saved.publicTitle).toBe("Mantém-se");
  });

  it("fuso horário inválido é recusado; o resto grava", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateProjectInfoAction(
      IDLE,
      projectInfoForm(campaign, { timezone: "Marte/Olympus", locale: "en-GB" }),
    );

    expect(fieldErrorKeys(result)).toEqual(["timezone"]);
    expect(fieldError(result, "timezone")).toBe("Fuso horário: inválido.");
    const saved = await reload(campaign.id);
    expect(saved.timezone).toBe("Europe/Lisbon");
    expect(saved.locale).toBe("en-GB");

    expect((await updateProjectInfoAction(IDLE, projectInfoForm(saved, { timezone: "Atlantic/Azores" }))).status).toBe(
      "success",
    );
    expect((await reload(campaign.id)).timezone).toBe("Atlantic/Azores");
  });

  it("campanha de outra organização: 404, sem gravar nada", async () => {
    const foreign = await createCampaign(other);
    session.current = org.admin;

    await expect(
      updateProjectInfoAction(IDLE, projectInfoForm(foreign, { internalName: "Invasor" })),
    ).rejects.toMatchObject(NOT_FOUND);
    expect((await reload(foreign.id)).internalName).toBe("Nome original");
  });
});

describe("Agenda", () => {
  it("início depois do fim: recusa as duas datas e grava as mensagens", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, {
        scheduleStartAt: "2030-07-10T10:00",
        scheduleEndAt: "2030-07-01T10:00",
        scheduleBeforeMessage: "Em breve",
        scheduleAfterMessage: "Acabou",
      }),
    );

    expect(result).toMatchObject({ status: "error", message: PARTIAL_SAVE_MESSAGE });
    expect(result.status === "error" && result.fieldErrors).toEqual({ scheduleEndAt: SCHEDULE_ORDER_MESSAGE });
    const saved = await reload(campaign.id);
    expect(saved.scheduleStartAt?.toISOString()).toBe(campaign.scheduleStartAt?.toISOString());
    expect(saved.scheduleEndAt?.toISOString()).toBe(campaign.scheduleEndAt?.toISOString());
    expect(saved.scheduleBeforeMessage).toBe("Em breve");
    expect(saved.scheduleAfterMessage).toBe("Acabou");
  });

  it("compara com a data gravada do outro lado: um fim antes do início gravado é recusado", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    // O início enviado é inválido e fica o gravado (1 de junho); o fim de maio fica antes dele.
    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, { scheduleStartAt: "0202-06-01T10:00", scheduleEndAt: "2030-05-15T10:00" }),
    );

    expect(result.status === "error" && result.fieldErrors).toEqual({
      scheduleStartAt: "Início: data inválida.",
      scheduleEndAt: SCHEDULE_ORDER_MESSAGE,
    });
    const saved = await reload(campaign.id);
    expect(saved.scheduleStartAt?.toISOString()).toBe(campaign.scheduleStartAt?.toISOString());
    expect(saved.scheduleEndAt?.toISOString()).toBe(campaign.scheduleEndAt?.toISOString());
  });

  it("redirecionamento javascript: é recusado; as mensagens gravam", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, { scheduleRedirectUrl: "javascript:alert(1)", scheduleAfterMessage: "Obrigado" }),
    );

    expect(result.status === "error" && Object.keys(result.fieldErrors)).toEqual(["scheduleRedirectUrl"]);
    const saved = await reload(campaign.id);
    expect(saved.scheduleRedirectUrl).toBe("https://antes.example");
    expect(saved.scheduleAfterMessage).toBe("Obrigado");
    expect(saved.scheduleStartAt?.toISOString()).toBe(campaign.scheduleStartAt?.toISOString());
  });

  it("as datas são hora de parede no fuso da campanha; vazio apaga; audita antes/depois", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    // Lisboa em julho: UTC+1.
    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, { scheduleStartAt: "2030-07-01T10:00", scheduleEndAt: "" }),
    );

    expect(result.status).toBe("success");
    const saved = await reload(campaign.id);
    expect(saved.scheduleStartAt?.toISOString()).toBe("2030-07-01T09:00:00.000Z");
    expect(saved.scheduleEndAt).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: campaign.id, action: "UPDATE" } });
    expect(audit.metadata).toMatchObject({
      field: "schedule",
      startBefore: "2030-06-01T09:00:00.000Z",
      startAfter: "2030-07-01T09:00:00.000Z",
      endBefore: "2030-06-30T21:00:00.000Z",
      endAfter: null,
    });
  });

  it("mensagem acima do limite volta com o nome do campo; as datas gravam", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, { scheduleBeforeMessage: "x".repeat(501), scheduleEndAt: "2030-08-01T10:00" }),
    );

    expect(result.status === "error" && result.fieldErrors).toEqual({
      scheduleBeforeMessage: "Mensagem antes do início: máximo 500 caracteres.",
    });
    const saved = await reload(campaign.id);
    expect(saved.scheduleBeforeMessage).toBe("Antes");
    expect(saved.scheduleEndAt?.toISOString()).toBe("2030-08-01T09:00:00.000Z");
  });

  it("campanha publicada, Editor sem permissão de publicar: as mensagens gravam, as datas ficam", async () => {
    const campaign = await createCampaign(org, { status: "PUBLISHED", publishedAt: new Date() });
    session.current = org.editor;

    // Como a página envia: as datas vão desativadas.
    const result = await updateScheduleAction(
      IDLE,
      scheduleForm(campaign, { scheduleAfterMessage: "Terminou" }, { datesLocked: true }),
    );
    expect(result.status).toBe("success");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: campaign.id, action: "UPDATE" } });
    expect(audit.metadata).toEqual({ field: "schedule" });

    // Uma página aberta antes da publicação envia as datas: iguais às gravadas, não há erro.
    const stale = await updateScheduleAction(IDLE, scheduleForm(await reload(campaign.id), { scheduleBeforeMessage: "Já" }));
    expect(stale.status).toBe("success");

    const saved = await reload(campaign.id);
    expect(saved.scheduleAfterMessage).toBe("Terminou");
    expect(saved.scheduleBeforeMessage).toBe("Já");
    expect(saved.scheduleStartAt?.toISOString()).toBe(campaign.scheduleStartAt?.toISOString());
    expect(saved.scheduleEndAt?.toISOString()).toBe(campaign.scheduleEndAt?.toISOString());
  });
});

describe("Regras de participação", () => {
  it("«Máximo personalizado» sem máximo: o tipo não muda, o campo diz o que falta e a idade grava", async () => {
    const campaign = await createCampaign(org, { participationLimitType: "UNLIMITED" });
    session.current = org.editor;

    // Sem o campo (a página antiga enviava-o desativado) e com ele vazio.
    for (const customMax of [undefined, ""]) {
      const result = await updateParticipationRulesAction(IDLE, rulesForm("CUSTOM_MAX", customMax, "21", campaign.id));

      expect(result.status === "error" && result.fieldErrors).toEqual({
        participationCustomMax: PARTICIPATION_CUSTOM_MAX_REQUIRED_MESSAGE,
      });
    }

    const saved = await reload(campaign.id);
    expect(saved.participationLimitType).toBe("UNLIMITED");
    expect(saved.participationCustomMax).toBeNull();
    expect(saved.minAge).toBe(21);
  });

  it("«Máximo personalizado» com máximo grava os dois e audita antes/depois", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("CUSTOM_MAX", "5", "18", campaign.id));

    expect(result.status).toBe("success");
    expect(await reload(campaign.id)).toMatchObject({ participationLimitType: "CUSTOM_MAX", participationCustomMax: 5 });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: campaign.id, action: "UPDATE" } });
    expect(audit.metadata).toMatchObject({
      step: "regras",
      participationLimitTypeBefore: "ONE_TOTAL",
      participationLimitTypeAfter: "CUSTOM_MAX",
      participationCustomMaxBefore: null,
      participationCustomMaxAfter: 5,
    });
  });

  it("máximo inválido: a mensagem é a do limite, e o tipo não muda sem máximo", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("CUSTOM_MAX", "0", "18", campaign.id));

    expect(result.status === "error" && result.fieldErrors).toEqual({
      participationCustomMax: "Máximo de participações: mínimo 1.",
    });
    expect((await reload(campaign.id)).participationLimitType).toBe("ONE_TOTAL");
  });

  it("apagar o máximo de um limite personalizado não o apaga", async () => {
    const campaign = await createCampaign(org, { participationLimitType: "CUSTOM_MAX", participationCustomMax: 5 });
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("CUSTOM_MAX", "", "18", campaign.id));

    expect(result.status === "error" && Object.keys(result.fieldErrors)).toEqual(["participationCustomMax"]);
    expect(await reload(campaign.id)).toMatchObject({ participationLimitType: "CUSTOM_MAX", participationCustomMax: 5 });
  });

  it("outro tipo de limite: o máximo fica a null", async () => {
    const campaign = await createCampaign(org, { participationLimitType: "CUSTOM_MAX", participationCustomMax: 5 });
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("ONE_PER_DAY", undefined, "18", campaign.id));

    expect(result.status).toBe("success");
    expect(await reload(campaign.id)).toMatchObject({ participationLimitType: "ONE_PER_DAY", participationCustomMax: null });
  });

  it("idade mínima fora do intervalo não impede o limite de gravar; vazio apaga", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const refused = await updateParticipationRulesAction(IDLE, rulesForm("ONE_PER_HOUR", undefined, "200", campaign.id));
    expect(refused.status === "error" && refused.fieldErrors).toEqual({ minAge: "Idade mínima: máximo 120." });
    expect(await reload(campaign.id)).toMatchObject({ participationLimitType: "ONE_PER_HOUR", minAge: 18 });

    const cleared = await updateParticipationRulesAction(IDLE, rulesForm("ONE_PER_HOUR", undefined, "", campaign.id));
    expect(cleared.status).toBe("success");
    expect((await reload(campaign.id)).minAge).toBeNull();
  });

  it("idade 0 é recusada: não restringe ninguém", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("ONE_TOTAL", undefined, "0", campaign.id));

    expect(result.status === "error" && result.fieldErrors).toEqual({ minAge: "Idade mínima: mínimo 1." });
    expect((await reload(campaign.id)).minAge).toBe(18);
  });

  it("numa campanha publicada sem data de nascimento, a idade mínima é recusada e o limite grava", async () => {
    const campaign = await createCampaign(org, { status: "PUBLISHED", minAge: null });
    await prisma.leadForm.create({
      data: {
        campaignId: campaign.id,
        position: "BEFORE_GAME",
        fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", order: 0 }] },
      },
    });
    session.current = org.editor;

    const refused = await updateParticipationRulesAction(IDLE, rulesForm("ONE_PER_DAY", undefined, "18", campaign.id));

    expect(refused).toMatchObject({
      status: "error",
      message: PARTIAL_SAVE_MESSAGE,
      fieldErrors: { minAge: LIVE_MIN_AGE_NEEDS_BIRTH_DATE_MESSAGE },
    });
    expect(await reload(campaign.id)).toMatchObject({ participationLimitType: "ONE_PER_DAY", minAge: null });

    // Com a data de nascimento no formulário, já grava.
    await prisma.leadFormField.create({
      data: {
        leadForm: { connect: { campaignId: campaign.id } },
        type: "BIRTH_DATE",
        internalKey: "nascimento",
        label: "Nascimento",
        order: 1,
      },
    });
    const saved = await updateParticipationRulesAction(IDLE, rulesForm("ONE_PER_DAY", undefined, "18", campaign.id));
    expect(saved.status).toBe("success");
    expect((await reload(campaign.id)).minAge).toBe(18);
  });

  it("tipo desconhecido é recusado com mensagem em português", async () => {
    const campaign = await createCampaign(org);
    session.current = org.editor;

    const result = await updateParticipationRulesAction(IDLE, rulesForm("SEM_LIMITE", undefined, "18", campaign.id));

    expect(result.status === "error" && result.fieldErrors).toEqual({
      participationLimitType: "Limite de participação: opção inválida.",
    });
    expect((await reload(campaign.id)).participationLimitType).toBe("ONE_TOTAL");
  });

  it("um Visualizador não altera as regras", async () => {
    const campaign = await createCampaign(org);
    const membership = org.editor.membership;
    if (!membership) throw new Error("Fixture sem membership.");
    session.current = { ...org.editor, membership: { ...membership, role: "VIEWER" } };

    const result = await updateParticipationRulesAction(IDLE, rulesForm("UNLIMITED", undefined, "", campaign.id));

    expect(result).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });
    expect((await reload(campaign.id)).participationLimitType).toBe("ONE_TOTAL");
  });
});
