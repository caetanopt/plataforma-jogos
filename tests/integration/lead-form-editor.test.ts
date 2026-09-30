import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { ConsentDefinition, LeadFormField, Membership, MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Etapa Formulário de leads (passo 5a). A edição de um campo nunca gravava
 * (o `formData.get` dava null para o que o formulário não mostra e o zod
 * recusava tudo); as definições e os consentimentos saíam em silêncio numa
 * recusa. Cada teste envia os campos que a página envia de facto.
 *
 * As ações correm a sério contra a base de dados; só se substitui a sessão e
 * o cache do Next.
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
const { CONSENT_IN_USE_MESSAGE, CONSENT_MARKETING_REQUIRED_MESSAGE, LEAD_FIELD_LIMITS } = await import(
  "@/lib/validation/lead-form"
);
const {
  addConsentAction,
  addLeadFieldAction,
  moveLeadFieldAction,
  removeConsentAction,
  removeLeadFieldAction,
  updateConsentAction,
  updateLeadFieldAction,
  updateLeadFormSettingsAction,
} = await import("@/features/campaigns/steps/lead-form-actions");

const { LIVE_BIRTH_DATE_REQUIRED_MESSAGE, LIVE_POSITION_NEEDS_FORM_MESSAGE } = await import(
  "@/features/publishing/age-check"
);

const NOT_FOUND = { digest: expect.stringContaining("404") };

interface Org {
  id: string;
  workspaceId: string;
  admin: OrgContext;
  viewer: OrgContext;
  cleanup: () => Promise<void>;
}

async function createOrg(label: string): Promise<Org> {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `LF ${suffix}`, slug: `lf-${suffix}` } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Principal", slug: `lf-${suffix}` },
  });

  const userIds: string[] = [];
  async function member(role: MembershipRole): Promise<OrgContext> {
    const user = await prisma.user.create({
      data: { name: role, email: `lf-${role.toLowerCase()}-${suffix}@example.com`, passwordHash: "x" },
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
  const viewer = await member("VIEWER");

  return {
    id: organization.id,
    workspaceId: workspace.id,
    admin,
    viewer,
    cleanup: async () => {
      // ConsentRecord → ConsentDefinition é RESTRICT: sai antes da campanha.
      await prisma.consentRecord.deleteMany({ where: { participation: { campaign: { organizationId: organization.id } } } });
      await prisma.campaign.deleteMany({ where: { organizationId: organization.id } });
      await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
      await prisma.membership.deleteMany({ where: { organizationId: organization.id } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.workspace.deleteMany({ where: { organizationId: organization.id } });
      await prisma.organization.delete({ where: { id: organization.id } });
    },
  };
}

interface Fixture {
  campaignId: string;
  leadFormId: string;
  email: LeadFormField;
  dropdown: LeadFormField;
  consent: ConsentDefinition;
}

/** Campanha com um formulário preenchido em tudo, para ver que nada se perde. */
async function createCampaign(target: Org): Promise<Fixture> {
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: target.id,
      workspaceId: target.workspaceId,
      type: "MEMORY",
      internalName: "Formulário",
      ownerId: target.admin.userId,
      slug: `lf-${randomUUID()}`,
      dedupStrategies: ["COOKIE"],
      leadForm: { create: { position: "BEFORE_GAME", honeypotEnabled: true } },
    },
    include: { leadForm: true },
  });
  const leadFormId = campaign.leadForm!.id;
  const email = await prisma.leadFormField.create({
    data: {
      leadFormId,
      type: "EMAIL",
      internalKey: "email",
      label: "E-mail",
      placeholder: "nome@exemplo.pt",
      helpText: "Para enviar o prémio.",
      required: true,
      order: 0,
      // Sem campo no editor: têm de sobreviver a qualquer gravação.
      validationRegex: "^.+@caetano\\.pt$",
      defaultValue: "geral@caetano.pt",
      exportMapping: "EMAIL",
    },
  });
  const dropdown = await prisma.leadFormField.create({
    data: {
      leadFormId,
      type: "DROPDOWN",
      internalKey: "loja",
      label: "Loja",
      order: 1,
      options: ["Lisboa", "Porto"],
    },
  });
  const consent = await prisma.consentDefinition.create({
    data: { leadFormId, text: "Aceito o regulamento.", version: 1, required: true, order: 0 },
  });
  return { campaignId: campaign.id, leadFormId, email, dropdown, consent };
}

function reloadField(id: string) {
  return prisma.leadFormField.findUniqueOrThrow({ where: { id } });
}

function reloadConsent(id: string) {
  return prisma.consentDefinition.findUniqueOrThrow({ where: { id } });
}

type Entries = Array<[string, string]>;

function toForm(entries: Entries): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

/** Checkbox do CheckboxField: a sentinela e, se marcada, o "on". */
function checkbox(name: string, checked: boolean): Entries {
  return checked ? [[name, ""], [name, "on"]] : [[name, ""]];
}

/**
 * O que a edição de um campo envia: os valores gravados mais as alterações.
 * As opções só existem nos tipos de escolha; a expressão de validação e o
 * valor predefinido nunca.
 */
function fieldEditForm(
  campaignId: string,
  field: LeadFormField,
  changes: { label?: string; placeholder?: string; helpText?: string; options?: string; exportMapping?: string; required?: boolean } = {},
): FormData {
  const entries: Entries = [
    ["campaignId", campaignId],
    ["fieldId", field.id],
    ["label", changes.label ?? field.label],
    ["placeholder", changes.placeholder ?? field.placeholder ?? ""],
    ["helpText", changes.helpText ?? field.helpText ?? ""],
  ];
  if (field.type === "DROPDOWN" || field.type === "SINGLE_CHOICE" || field.type === "MULTIPLE_CHOICE") {
    const stored = Array.isArray(field.options) ? field.options.join("\n") : "";
    entries.push(["options", changes.options ?? stored]);
  }
  entries.push(["exportMapping", changes.exportMapping ?? field.exportMapping ?? ""]);
  entries.push(...checkbox("required", changes.required ?? field.required));
  return toForm(entries);
}

/** O que as definições enviam. */
function settingsForm(campaignId: string, position: string, honeypot: boolean, dedup: string[]): FormData {
  return toForm([
    ["campaignId", campaignId],
    ["position", position],
    ...checkbox("honeypotEnabled", honeypot),
    ["dedupStrategies", ""],
    ...dedup.map((value): [string, string] => ["dedupStrategies", value]),
  ]);
}

function consentForm(
  campaignId: string,
  fields: { consentId?: string; text: string; isMarketing: boolean; required: boolean },
): FormData {
  return toForm([
    ["campaignId", campaignId],
    ...(fields.consentId ? ([["consentId", fields.consentId]] as Entries) : []),
    ["text", fields.text],
    ...checkbox("isMarketing", fields.isMarketing),
    ...checkbox("required", fields.required),
  ]);
}

let org: Org;
let other: Org;
let fixture: Fixture;

beforeAll(async () => {
  org = await createOrg("a");
  other = await createOrg("b");
});

beforeEach(async () => {
  fixture = await createCampaign(org);
  session.current = org.admin;
});

afterEach(() => {
  session.current = null;
});

afterAll(async () => {
  await org.cleanup();
  await other.cleanup();
  await prisma.$disconnect();
});

describe("editar um campo (gravação automática)", () => {
  it("grava o que o formulário envia e mantém a expressão de validação e o valor predefinido", async () => {
    const result = await updateLeadFieldAction(
      IDLE,
      fieldEditForm(fixture.campaignId, fixture.email, {
        label: "  E-mail profissional ",
        placeholder: "voce@empresa.pt",
        helpText: "",
        exportMapping: "work_email",
        required: false,
      }),
    );

    expect(result.status).toBe("success");
    const saved = await reloadField(fixture.email.id);
    expect(saved).toMatchObject({
      label: "E-mail profissional",
      placeholder: "voce@empresa.pt",
      helpText: null,
      exportMapping: "work_email",
      required: false,
      // Não estão no formulário: ficam como estavam.
      validationRegex: "^.+@caetano\\.pt$",
      defaultValue: "geral@caetano.pt",
      options: null,
      type: "EMAIL",
      internalKey: "email",
      order: 0,
    });
  });

  it("um label vazio volta com o erro e o resto grava", async () => {
    const result = await updateLeadFieldAction(
      IDLE,
      fieldEditForm(fixture.campaignId, fixture.email, { label: "   ", placeholder: "Novo placeholder" }),
    );

    expect(result).toMatchObject({
      status: "error",
      message: PARTIAL_SAVE_MESSAGE,
      fieldErrors: { label: "Label: obrigatório." },
    });
    const saved = await reloadField(fixture.email.id);
    expect(saved.label).toBe("E-mail");
    expect(saved.placeholder).toBe("Novo placeholder");
  });

  it("recusa um label acima do limite sem mexer no gravado", async () => {
    const result = await updateLeadFieldAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["fieldId", fixture.email.id],
        ["label", "x".repeat(LEAD_FIELD_LIMITS.label + 1)],
      ]),
    );

    expect(result).toMatchObject({
      status: "error",
      message: NOTHING_SAVED_MESSAGE,
      fieldErrors: { label: `Label: máximo ${LEAD_FIELD_LIMITS.label} caracteres.` },
    });
    expect((await reloadField(fixture.email.id)).label).toBe("E-mail");
  });

  it("opções: uma por linha, sem linhas em branco, e CRLF do envio não conta", async () => {
    const result = await updateLeadFieldAction(
      IDLE,
      fieldEditForm(fixture.campaignId, fixture.dropdown, { options: "Lisboa\r\n\r\n  Braga  \r\nFaro\r\n" }),
    );

    expect(result.status).toBe("success");
    expect((await reloadField(fixture.dropdown.id)).options).toEqual(["Lisboa", "Braga", "Faro"]);
  });

  it("ignora opções enviadas para um campo que não é de escolha", async () => {
    const form = fieldEditForm(fixture.campaignId, fixture.email);
    form.set("options", "A\nB");

    const result = await updateLeadFieldAction(IDLE, form);

    expect(result.status).toBe("success");
    expect((await reloadField(fixture.email.id)).options).toBeNull();
  });

  it("não aceita o campo de outra organização", async () => {
    const foreign = await createCampaign(other);

    await expect(
      updateLeadFieldAction(IDLE, fieldEditForm(fixture.campaignId, foreign.email, { label: "Roubado" })),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      updateLeadFieldAction(IDLE, fieldEditForm(foreign.campaignId, foreign.email, { label: "Roubado" })),
    ).rejects.toMatchObject(NOT_FOUND);
    expect((await reloadField(foreign.email.id)).label).toBe("E-mail");
  });

  it("um visualizador não edita", async () => {
    session.current = org.viewer;

    const result = await updateLeadFieldAction(IDLE, fieldEditForm(fixture.campaignId, fixture.email, { label: "Não" }));

    expect(result).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });
    expect((await reloadField(fixture.email.id)).label).toBe("E-mail");
  });
});

describe("definições do formulário (gravação automática)", () => {
  it("uma posição inválida não impede o honeypot e os duplicados de gravar", async () => {
    const result = await updateLeadFormSettingsAction(
      IDLE,
      settingsForm(fixture.campaignId, "EM_TODO_O_LADO", false, ["EMAIL", "PHONE"]),
    );

    expect(result).toMatchObject({
      status: "error",
      message: PARTIAL_SAVE_MESSAGE,
      fieldErrors: { position: "Posição do formulário: opção inválida." },
    });
    const leadForm = await prisma.leadForm.findUniqueOrThrow({ where: { id: fixture.leadFormId } });
    expect(leadForm.position).toBe("BEFORE_GAME");
    expect(leadForm.honeypotEnabled).toBe(false);
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } });
    expect(campaign.dedupStrategies).toEqual(["EMAIL", "PHONE"]);
  });

  it("desmarcar todos os duplicados grava a lista vazia", async () => {
    const result = await updateLeadFormSettingsAction(IDLE, settingsForm(fixture.campaignId, "AFTER_GAME", true, []));

    expect(result.status).toBe("success");
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: fixture.campaignId },
      include: { leadForm: true },
    });
    expect(campaign.dedupStrategies).toEqual([]);
    expect(campaign.leadForm).toMatchObject({ position: "AFTER_GAME", honeypotEnabled: true });
  });

  it("recusa uma estratégia de duplicados desconhecida", async () => {
    const result = await updateLeadFormSettingsAction(
      IDLE,
      settingsForm(fixture.campaignId, "BEFORE_GAME", true, ["EMAIL", "TELEPATIA"]),
    );

    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { dedupStrategies: "Controlo de duplicados: opção inválida." },
    });
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: fixture.campaignId } });
    expect(campaign.dedupStrategies).toEqual(["COOKIE"]);
  });
});

describe("adicionar, remover e reordenar campos", () => {
  it("um label vazio devolve fieldErrors.label e não cria nada", async () => {
    const before = await prisma.leadFormField.count({ where: { leadFormId: fixture.leadFormId } });

    const result = await addLeadFieldAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["type", "SHORT_TEXT"],
        ["label", "  "],
      ]),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { label: "Label: obrigatório." } });
    expect(await prisma.leadFormField.count({ where: { leadFormId: fixture.leadFormId } })).toBe(before);
  });

  it("adiciona no fim da lista", async () => {
    const result = await addLeadFieldAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["type", "COMPANY"],
        ["label", "Empresa"],
      ]),
    );

    expect(result).toMatchObject({ status: "success", message: "Campo adicionado." });
    const created = await prisma.leadFormField.findFirstOrThrow({
      where: { leadFormId: fixture.leadFormId, label: "Empresa" },
    });
    expect(created).toMatchObject({ type: "COMPANY", internalKey: "empresa", order: 2, required: false });
  });

  it("reordenar na ponta responde com erro e não mexe na ordem", async () => {
    const result = await moveLeadFieldAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["fieldId", fixture.email.id],
        ["direction", "up"],
      ]),
    );

    expect(result).toMatchObject({ status: "error", message: "O campo já é o primeiro da lista." });
    expect((await reloadField(fixture.email.id)).order).toBe(0);
  });

  it("troca com o vizinho", async () => {
    const result = await moveLeadFieldAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["fieldId", fixture.email.id],
        ["direction", "down"],
      ]),
    );

    expect(result.status).toBe("success");
    expect((await reloadField(fixture.email.id)).order).toBe(1);
    expect((await reloadField(fixture.dropdown.id)).order).toBe(0);
  });

  it("remover duas vezes: a segunda diz que já não existe", async () => {
    const form = () =>
      toForm([
        ["campaignId", fixture.campaignId],
        ["fieldId", fixture.dropdown.id],
      ]);

    expect((await removeLeadFieldAction(IDLE, form())).status).toBe("success");
    expect(await prisma.leadFormField.findUnique({ where: { id: fixture.dropdown.id } })).toBeNull();
    expect(await removeLeadFieldAction(IDLE, form())).toMatchObject({
      status: "error",
      message: "O campo já não existe. Recarregue a página.",
    });
  });
});

describe("campanha publicada com idade mínima", () => {
  async function withBirthDate(status: "PUBLISHED" | "DRAFT", minAge: number | null) {
    await prisma.campaign.update({ where: { id: fixture.campaignId }, data: { status, minAge } });
    return prisma.leadFormField.create({
      data: { leadFormId: fixture.leadFormId, type: "BIRTH_DATE", internalKey: "nascimento", label: "Nascimento", order: 2 },
    });
  }

  function removeForm(fieldId: string): FormData {
    return toForm([
      ["campaignId", fixture.campaignId],
      ["fieldId", fieldId],
    ]);
  }

  it("não remove a data de nascimento: a campanha deixava de aceitar participações", async () => {
    const birthDate = await withBirthDate("PUBLISHED", 18);

    expect(await removeLeadFieldAction(IDLE, removeForm(birthDate.id))).toMatchObject({
      status: "error",
      message: LIVE_BIRTH_DATE_REQUIRED_MESSAGE,
    });
    expect(await prisma.leadFormField.findUnique({ where: { id: birthDate.id } })).not.toBeNull();
    // Os outros campos removem-se normalmente.
    expect((await removeLeadFieldAction(IDLE, removeForm(fixture.dropdown.id))).status).toBe("success");
  });

  it("não passa a «Sem formulário», e o resto das definições grava", async () => {
    await withBirthDate("PUBLISHED", 18);

    const result = await updateLeadFormSettingsAction(IDLE, settingsForm(fixture.campaignId, "NONE", false, ["EMAIL"]));

    expect(result).toMatchObject({
      status: "error",
      message: PARTIAL_SAVE_MESSAGE,
      fieldErrors: { position: LIVE_POSITION_NEEDS_FORM_MESSAGE },
    });
    const leadForm = await prisma.leadForm.findUniqueOrThrow({ where: { id: fixture.leadFormId } });
    expect(leadForm).toMatchObject({ position: "BEFORE_GAME", honeypotEnabled: false });
    // Outra posição com formulário continua a poder mudar.
    const moved = await updateLeadFormSettingsAction(IDLE, settingsForm(fixture.campaignId, "AFTER_GAME", false, ["EMAIL"]));
    expect(moved.status).toBe("success");
  });

  it("num rascunho, ou sem idade mínima, a data de nascimento remove-se", async () => {
    const draftField = await withBirthDate("DRAFT", 18);
    expect((await removeLeadFieldAction(IDLE, removeForm(draftField.id))).status).toBe("success");

    const liveField = await withBirthDate("PUBLISHED", null);
    expect((await removeLeadFieldAction(IDLE, removeForm(liveField.id))).status).toBe("success");
  });
});

describe("consentimentos", () => {
  it("recusa criar um consentimento de marketing obrigatório", async () => {
    const before = await prisma.consentDefinition.count({ where: { leadFormId: fixture.leadFormId } });

    const result = await addConsentAction(
      IDLE,
      consentForm(fixture.campaignId, { text: "Quero receber novidades.", isMarketing: true, required: true }),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { required: CONSENT_MARKETING_REQUIRED_MESSAGE } });
    expect(await prisma.consentDefinition.count({ where: { leadFormId: fixture.leadFormId } })).toBe(before);
  });

  it("cria um consentimento de marketing opcional na versão 1", async () => {
    const result = await addConsentAction(
      IDLE,
      consentForm(fixture.campaignId, { text: "Quero receber novidades.", isMarketing: true, required: false }),
    );

    expect(result.status).toBe("success");
    const created = await prisma.consentDefinition.findFirstOrThrow({
      where: { leadFormId: fixture.leadFormId, text: "Quero receber novidades." },
    });
    expect(created).toMatchObject({ version: 1, isMarketing: true, required: false, order: 1 });
  });

  it("recusa tornar um consentimento de marketing e obrigatório ao editar", async () => {
    const result = await updateConsentAction(
      IDLE,
      consentForm(fixture.campaignId, {
        consentId: fixture.consent.id,
        text: "Texto novo",
        isMarketing: true,
        required: true,
      }),
    );

    expect(result).toMatchObject({ status: "error", fieldErrors: { required: CONSENT_MARKETING_REQUIRED_MESSAGE } });
    expect(await reloadConsent(fixture.consent.id)).toMatchObject({
      text: "Aceito o regulamento.",
      version: 1,
      isMarketing: false,
      required: true,
    });
  });

  it("texto novo cria uma versão nova", async () => {
    const result = await updateConsentAction(
      IDLE,
      consentForm(fixture.campaignId, {
        consentId: fixture.consent.id,
        text: "Aceito o regulamento e a política de privacidade.",
        isMarketing: false,
        required: true,
      }),
    );

    expect(result).toMatchObject({ status: "success", message: "Guardado — versão 2." });
    expect(await reloadConsent(fixture.consent.id)).toMatchObject({
      text: "Aceito o regulamento e a política de privacidade.",
      version: 2,
    });
  });

  it("mudar só as opções mantém a versão", async () => {
    const result = await updateConsentAction(
      IDLE,
      consentForm(fixture.campaignId, {
        consentId: fixture.consent.id,
        text: "Aceito o regulamento.",
        isMarketing: false,
        required: false,
      }),
    );

    expect(result).toMatchObject({ status: "success", message: "Guardado." });
    expect(await reloadConsent(fixture.consent.id)).toMatchObject({ version: 1, required: false });
  });

  it("as mudanças de linha do envio (CRLF) não contam como texto novo", async () => {
    await prisma.consentDefinition.update({
      where: { id: fixture.consent.id },
      data: { text: "Linha 1\nLinha 2" },
    });

    const result = await updateConsentAction(
      IDLE,
      consentForm(fixture.campaignId, {
        consentId: fixture.consent.id,
        text: "Linha 1\r\nLinha 2",
        isMarketing: false,
        required: true,
      }),
    );

    expect(result).toMatchObject({ status: "success", message: "Guardado." });
    expect(await reloadConsent(fixture.consent.id)).toMatchObject({ text: "Linha 1\nLinha 2", version: 1 });
  });

  it("um consentimento já aceite não é removido e a definição fica", async () => {
    const version = await prisma.campaignVersion.create({
      data: { campaignId: fixture.campaignId, versionNumber: 1, snapshot: {}, publishedById: org.admin.userId },
    });
    const participation = await prisma.participation.create({
      data: { campaignId: fixture.campaignId, campaignVersionId: version.id, idempotencyKey: randomUUID() },
    });
    await prisma.consentRecord.create({
      data: {
        participationId: participation.id,
        consentDefinitionId: fixture.consent.id,
        status: "GRANTED",
        text: fixture.consent.text,
        version: fixture.consent.version,
      },
    });

    const result = await removeConsentAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["consentId", fixture.consent.id],
      ]),
    );

    expect(result).toMatchObject({ status: "error", message: CONSENT_IN_USE_MESSAGE });
    expect(await prisma.consentDefinition.findUnique({ where: { id: fixture.consent.id } })).not.toBeNull();
  });

  it("remove um consentimento sem aceitações", async () => {
    const result = await removeConsentAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["consentId", fixture.consent.id],
      ]),
    );

    expect(result.status).toBe("success");
    expect(await prisma.consentDefinition.findUnique({ where: { id: fixture.consent.id } })).toBeNull();
  });

  it("não remove o consentimento de outra organização", async () => {
    const foreign = await createCampaign(other);

    const result = await removeConsentAction(
      IDLE,
      toForm([
        ["campaignId", fixture.campaignId],
        ["consentId", foreign.consent.id],
      ]),
    );

    expect(result.status).toBe("error");
    expect(await prisma.consentDefinition.findUnique({ where: { id: foreign.consent.id } })).not.toBeNull();
  });
});
