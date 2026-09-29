import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { OrgContext } from "@/server/auth/session";
import type { PublicGameFlowProps } from "@/components/public-game/public-game-flow";

/**
 * Ecrãs intermédios e final (gravação parcial, desligar sem apagar) e
 * eliminação de uma campanha publicada com participações.
 *
 * As ações e a página pública correm a sério contra a base de dados;
 * substitui-se só a sessão, o cache do Next, a autenticação do jogo público
 * (visitante anónimo) e o componente cliente do jogo, de que só interessam
 * as props.
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
vi.mock("@/components/public-game/public-game-flow", () => ({ PublicGameFlow: () => null }));

const { IDLE } = await import("@/lib/forms/action-result");
const { updateIntermediateScreenAction } = await import("@/features/campaigns/steps/intermediate-screen-actions");
const { updateFinalScreenAction } = await import("@/features/campaigns/steps/final-screen-actions");
const { deleteCampaignAction, duplicateCampaignAction } = await import("@/features/campaigns/actions");
const { default: PublicPlayPage } = await import("@/app/play/[slug]/page");

const NOT_FOUND = { digest: expect.stringContaining("404") };

interface Fixture {
  organizationId: string;
  userId: string;
  workspaceId: string;
  context: OrgContext;
}

const cleanups: Array<() => Promise<void>> = [];

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({
    data: { name: `Ecrãs ${suffix}`, slug: `ecras-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `ecras-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Ecrãs", slug: `ecras-${suffix}` },
  });

  cleanups.push(async () => {
    const campaigns = { organizationId: organization.id };
    await prisma.analyticsEvent.deleteMany({ where: { campaign: campaigns } });
    await prisma.participation.deleteMany({ where: { campaign: campaigns } });
    await prisma.campaignVersion.deleteMany({ where: { campaign: campaigns } });
    await prisma.campaign.deleteMany({ where: campaigns });
    await prisma.campaignTheme.deleteMany({ where: { organizationId: organization.id } });
    await prisma.participant.deleteMany({ where: { organizationId: organization.id } });
    await prisma.mediaAsset.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.membership.deleteMany({ where: { organizationId: organization.id } });
    await prisma.workspace.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  return {
    organizationId: organization.id,
    userId: user.id,
    workspaceId: workspace.id,
    context: {
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      isSuperAdmin: false,
      organizationId: organization.id,
      membership,
    },
  };
}

async function createCampaign(f: Fixture, extra: Record<string, unknown> = {}) {
  return prisma.campaign.create({
    data: {
      organizationId: f.organizationId,
      workspaceId: f.workspaceId,
      type: "QUIZ",
      internalName: `Campanha ${randomUUID().slice(0, 6)}`,
      ownerId: f.userId,
      slug: `ecras-${randomUUID()}`,
      status: "PUBLISHED",
      ...extra,
    },
  });
}

async function createMedia(f: Fixture) {
  return prisma.mediaAsset.create({
    data: {
      organizationId: f.organizationId,
      uploadedById: f.userId,
      kind: "IMAGE",
      storageKey: `uploads/${f.organizationId}/${randomUUID()}.png`,
      url: "https://cdn.test/x.png",
      mimeType: "image/png",
      sizeBytes: 10,
    },
  });
}

/** Aceita valores repetidos: a checkbox marcada vai a seguir à sentinela. */
function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const CHECKED = ["", "on"];
const UNCHECKED = [""];

/** Exatamente o que o formulário de um ecrã intermédio envia. */
function intermediateForm(
  campaignId: string,
  kind: "INTERMEDIATE_BEFORE" | "INTERMEDIATE_AFTER",
  values: {
    enabled: boolean;
    title?: string;
    text?: string;
    mediaId?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    continueButtonLabel?: string;
  },
): FormData {
  return form({
    campaignId,
    kind,
    enabled: values.enabled ? CHECKED : UNCHECKED,
    title: values.title ?? "",
    text: values.text ?? "",
    mediaId: values.mediaId ?? "",
    ctaLabel: values.ctaLabel ?? "",
    ctaUrl: values.ctaUrl ?? "",
    continueButtonLabel: values.continueButtonLabel ?? "",
  });
}

async function publicFlowProps(slug: string): Promise<PublicGameFlowProps> {
  const element = await PublicPlayPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  });
  return (element.props as { children: { props: PublicGameFlowProps } }).children.props;
}

let f: Fixture;

beforeEach(async () => {
  f = await createFixture();
  session.current = f.context;
});

afterEach(async () => {
  session.current = null;
  while (cleanups.length) await cleanups.pop()!();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ecrã intermédio", () => {
  it("desativar mantém o conteúdo e o jogo público deixa de o mostrar", async () => {
    const campaign = await createCampaign(f);
    const media = await createMedia(f);
    const content = {
      title: "Antes de jogar",
      text: "Leia as regras.",
      mediaId: media.id,
      ctaLabel: "Saber mais",
      ctaUrl: "https://example.com/regras",
      continueButtonLabel: "Vamos",
    };

    const on = await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_BEFORE", { enabled: true, ...content }),
    );
    expect(on.status).toBe("success");
    expect((await publicFlowProps(campaign.slug)).intermediateBefore).toMatchObject({
      title: "Antes de jogar",
      ctaUrl: "https://example.com/regras",
      mediaUrl: "https://cdn.test/x.png",
    });

    const off = await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_BEFORE", { enabled: false, ...content }),
    );
    expect(off.status).toBe("success");

    const stored = await prisma.campaignScreen.findUniqueOrThrow({
      where: { campaignId_kind: { campaignId: campaign.id, kind: "INTERMEDIATE_BEFORE" } },
    });
    expect(stored).toMatchObject({ enabled: false, ...content });
    expect((await publicFlowProps(campaign.slug)).intermediateBefore).toBeNull();

    // Voltar a ativar repõe o mesmo conteúdo, sem o reescrever.
    await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_BEFORE", { enabled: true, ...content }),
    );
    expect((await publicFlowProps(campaign.slug)).intermediateBefore).toMatchObject({ title: "Antes de jogar" });
  });

  it("um ecrã novo preenchido sem ativar fica desligado", async () => {
    const campaign = await createCampaign(f);

    const result = await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_AFTER", { enabled: false, title: "Depois" }),
    );

    expect(result.status).toBe("success");
    const stored = await prisma.campaignScreen.findUniqueOrThrow({
      where: { campaignId_kind: { campaignId: campaign.id, kind: "INTERMEDIATE_AFTER" } },
    });
    expect(stored).toMatchObject({ enabled: false, title: "Depois" });
    expect((await publicFlowProps(campaign.slug)).intermediateAfter).toBeNull();
  });

  it("recusa um link javascript: e grava os outros campos", async () => {
    const campaign = await createCampaign(f, {
      screens: { create: [{ kind: "INTERMEDIATE_BEFORE", title: "Antigo", ctaUrl: "https://example.com/antigo" }] },
    });

    const result = await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_BEFORE", {
        enabled: true,
        title: "Novo",
        text: "Texto novo",
        ctaUrl: "javascript:alert(1)",
      }),
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(Object.keys(result.fieldErrors)).toEqual(["ctaUrl"]);
    expect(result.fieldErrors.ctaUrl).toContain("Link do botão de ação");

    const stored = await prisma.campaignScreen.findUniqueOrThrow({
      where: { campaignId_kind: { campaignId: campaign.id, kind: "INTERMEDIATE_BEFORE" } },
    });
    expect(stored).toMatchObject({ title: "Novo", text: "Texto novo", ctaUrl: "https://example.com/antigo" });
  });

  it("um envio só com a checkbox não apaga o conteúdo", async () => {
    const campaign = await createCampaign(f, {
      screens: { create: [{ kind: "INTERMEDIATE_BEFORE", title: "Fica", text: "Também fica" }] },
    });

    await updateIntermediateScreenAction(
      IDLE,
      form({ campaignId: campaign.id, kind: "INTERMEDIATE_BEFORE", enabled: UNCHECKED }),
    );

    const stored = await prisma.campaignScreen.findUniqueOrThrow({
      where: { campaignId_kind: { campaignId: campaign.id, kind: "INTERMEDIATE_BEFORE" } },
    });
    expect(stored).toMatchObject({ enabled: false, title: "Fica", text: "Também fica" });
  });

  it("recusa media de outra organização, um ecrã desconhecido e campanhas alheias", async () => {
    const campaign = await createCampaign(f);
    const other = await createFixture();
    const foreignMedia = await createMedia(other);
    const foreignCampaign = await createCampaign(other);

    const media = await updateIntermediateScreenAction(
      IDLE,
      intermediateForm(campaign.id, "INTERMEDIATE_BEFORE", { enabled: true, title: "X", mediaId: foreignMedia.id }),
    );
    expect(media).toMatchObject({ status: "error", message: "A imagem escolhida não está disponível. Carregue-a de novo." });

    const kind = await updateIntermediateScreenAction(IDLE, form({ campaignId: campaign.id, kind: "FINAL", title: "X" }));
    expect(kind.status).toBe("error");

    expect(await prisma.campaignScreen.count({ where: { campaignId: campaign.id } })).toBe(0);

    await expect(
      updateIntermediateScreenAction(
        IDLE,
        intermediateForm(foreignCampaign.id, "INTERMEDIATE_BEFORE", { enabled: true, title: "Intruso" }),
      ),
    ).rejects.toMatchObject(NOT_FOUND);
    expect(await prisma.campaignScreen.count({ where: { campaignId: foreignCampaign.id } })).toBe(0);
  });
});

describe("ecrã final", () => {
  it("grava os campos válidos, recusa o link inválido e não mexe no resto da campanha", async () => {
    const media = await createMedia(f);
    const campaign = await createCampaign(f, {
      startTitle: "Ecrã inicial",
      regulationText: "Regulamento",
      finalTitle: "Título antigo",
      finalMessage: "Mensagem antiga",
      finalMediaId: media.id,
      finalCtaLabel: "Ver loja",
      finalCtaUrl: "https://example.com/loja",
      finalAllowReplay: true,
      finalAllowShare: false,
    });

    // Exatamente o que o formulário envia (a media vem do campo escondido).
    const result = await updateFinalScreenAction(
      IDLE,
      form({
        campaignId: campaign.id,
        finalTitle: "Obrigado!",
        finalMessage: "Mensagem nova",
        finalMediaId: media.id,
        finalCtaLabel: "Ver loja",
        finalCtaUrl: "javascript:alert(1)",
        finalAllowReplay: UNCHECKED,
        finalAllowShare: CHECKED,
      }),
    );

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(Object.keys(result.fieldErrors)).toEqual(["finalCtaUrl"]);

    const stored = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored).toMatchObject({
      finalTitle: "Obrigado!",
      finalMessage: "Mensagem nova",
      finalMediaId: media.id,
      finalCtaUrl: "https://example.com/loja",
      finalAllowReplay: false,
      finalAllowShare: true,
      startTitle: "Ecrã inicial",
      regulationText: "Regulamento",
    });
  });

  it("campos que o formulário não enviou ficam como estavam", async () => {
    const campaign = await createCampaign(f, {
      finalMessage: "Fica",
      finalCtaUrl: "https://example.com",
      finalAllowReplay: true,
      finalAllowShare: true,
    });

    const result = await updateFinalScreenAction(IDLE, form({ campaignId: campaign.id, finalTitle: "Só o título" }));

    expect(result.status).toBe("success");
    const stored = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored).toMatchObject({
      finalTitle: "Só o título",
      finalMessage: "Fica",
      finalCtaUrl: "https://example.com",
      finalAllowReplay: true,
      finalAllowShare: true,
    });
  });

  it("um título acima do limite volta com o erro e o resto grava-se", async () => {
    const campaign = await createCampaign(f, { finalTitle: "Antigo" });

    const result = await updateFinalScreenAction(
      IDLE,
      form({ campaignId: campaign.id, finalTitle: "x".repeat(201), finalMessage: "Nova" }),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { finalTitle: "Título: máximo 200 caracteres." } });
    const stored = await prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored).toMatchObject({ finalTitle: "Antigo", finalMessage: "Nova" });
  });
});

describe("duplicar campanha", () => {
  it("a cópia mantém o ecrã intermédio desligado", async () => {
    const campaign = await createCampaign(f, {
      screens: { create: [{ kind: "INTERMEDIATE_BEFORE", enabled: false, title: "Desligado" }] },
    });

    // Termina com redirect para o editor da cópia.
    await expect(duplicateCampaignAction(form({ campaignId: campaign.id }))).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });

    const copy = await prisma.campaign.findFirstOrThrow({
      where: { organizationId: f.organizationId, id: { not: campaign.id } },
      include: { screens: true },
    });
    expect(copy.screens).toEqual([expect.objectContaining({ kind: "INTERMEDIATE_BEFORE", enabled: false, title: "Desligado" })]);
  });
});

describe("eliminar campanha", () => {
  // Nesta base de dados a ordem dos triggers de cascata esconde a falha (a
  // cascata das participações corre antes da dos prémios); com a FK das
  // participações recriada, um DELETE simples da campanha dava P2003 no
  // PrizeAward → Prize. O teste garante que a eliminação não depende disso.
  it("elimina uma campanha publicada com participações, consentimentos e prémios", async () => {
    const campaign = await createCampaign(f, {
      type: "WHEEL",
      screens: { create: [{ kind: "INTERMEDIATE_BEFORE", title: "Antes" }] },
    });
    const version = await prisma.campaignVersion.create({
      data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: f.userId },
    });
    await prisma.publication.create({ data: { campaignVersionId: version.id, publishedById: f.userId } });
    const leadForm = await prisma.leadForm.create({
      data: {
        campaignId: campaign.id,
        position: "BEFORE_GAME",
        fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
        consentDefinitions: { create: [{ text: "Aceito o regulamento", required: true, order: 0 }] },
      },
      include: { consentDefinitions: true },
    });
    const prize = await prisma.prize.create({
      data: { campaignId: campaign.id, internalName: "Voucher", publicName: "Voucher", totalQuantity: 5, awardedQuantity: 1 },
    });
    const code = await prisma.prizeCode.create({
      data: { prizeId: prize.id, code: `DEL-${randomUUID()}`, status: "ASSIGNED" },
    });
    const wheel = await prisma.wheelConfig.create({
      data: {
        campaignId: campaign.id,
        segments: {
          create: [{ order: 0, name: "Ganhou", colorHex: "#00AEEF", outcome: "WIN", prizeId: prize.id, weight: 1 }],
        },
      },
      include: { segments: true },
    });
    const participant = await prisma.participant.create({
      data: { organizationId: f.organizationId, cookieId: `cookie-${randomUUID()}` },
    });
    const participation = await prisma.participation.create({
      data: {
        campaignId: campaign.id,
        campaignVersionId: version.id,
        participantId: participant.id,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
      },
    });
    await prisma.consentRecord.create({
      data: {
        participationId: participation.id,
        consentDefinitionId: leadForm.consentDefinitions[0]!.id,
        status: "GRANTED",
        text: "Aceito o regulamento",
        version: 1,
      },
    });
    await prisma.prizeAward.create({
      data: {
        participationId: participation.id,
        prizeId: prize.id,
        wheelSegmentId: wheel.segments[0]!.id,
        prizeCodeId: code.id,
      },
    });
    await prisma.analyticsEvent.create({ data: { campaignId: campaign.id, type: "CAMPAIGN_VIEWED" } });

    await deleteCampaignAction(form({ campaignId: campaign.id }));

    expect(await prisma.campaign.findUnique({ where: { id: campaign.id } })).toBeNull();
    expect(await prisma.campaignVersion.count({ where: { campaignId: campaign.id } })).toBe(0);
    expect(await prisma.publication.count({ where: { campaignVersionId: version.id } })).toBe(0);
    expect(await prisma.participation.count({ where: { campaignId: campaign.id } })).toBe(0);
    expect(await prisma.consentRecord.count({ where: { participationId: participation.id } })).toBe(0);
    expect(await prisma.prizeAward.count({ where: { participationId: participation.id } })).toBe(0);
    expect(await prisma.prize.count({ where: { campaignId: campaign.id } })).toBe(0);
    expect(await prisma.prizeCode.count({ where: { prizeId: prize.id } })).toBe(0);
    expect(await prisma.leadForm.count({ where: { campaignId: campaign.id } })).toBe(0);
    expect(await prisma.campaignScreen.count({ where: { campaignId: campaign.id } })).toBe(0);
    expect(await prisma.analyticsEvent.count({ where: { campaignId: campaign.id } })).toBe(0);
    // O participante é da organização (pode ter jogado noutras campanhas).
    expect(await prisma.participant.findUnique({ where: { id: participant.id } })).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: f.organizationId, action: "DELETE", entityId: campaign.id },
    });
    expect(audit?.metadata).toMatchObject({ participationsDeleted: 1 });
  });

  it("participações a começar durante a eliminação não a fazem falhar", async () => {
    const campaign = await createCampaign(f);
    const version = await prisma.campaignVersion.create({
      data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: f.userId },
    });
    const participate = () =>
      prisma.participation
        .create({ data: { campaignId: campaign.id, campaignVersionId: version.id, idempotencyKey: randomUUID() } })
        .then(
          () => "criada",
          () => "recusada",
        );
    await participate();

    // As que chegam depois da eliminação falham (a campanha já não existe);
    // a eliminação em si tem de terminar sempre.
    const [deleted] = await Promise.all([
      deleteCampaignAction(form({ campaignId: campaign.id })).then(() => "eliminada"),
      ...Array.from({ length: 20 }, participate),
    ]);

    expect(deleted).toBe("eliminada");
    expect(await prisma.campaign.findUnique({ where: { id: campaign.id } })).toBeNull();
    expect(await prisma.participation.count({ where: { campaignId: campaign.id } })).toBe(0);
  });

  it("não elimina campanhas de outra organização", async () => {
    const other = await createFixture();
    const foreign = await createCampaign(other);

    await expect(deleteCampaignAction(form({ campaignId: foreign.id }))).rejects.toMatchObject({
      digest: expect.stringContaining("/apps?error=not_found"),
    });
    expect(await prisma.campaign.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });
});
