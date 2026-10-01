import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { createCampaign, E2E_ADMIN_EMAIL, loginAsAdmin, uniqueSuffix } from "./helpers";

/**
 * Conservação dos dados (§24): o administrador anonimiza uma lead a partir
 * da lista (com confirmação) e define o prazo da organização.
 */

let organizationId: string | null = null;
let originalRetention: number | null = null;

/** Uma campanha com uma participação por e-mail (identidade e resposta ao formulário). */
async function subjectParticipations(page: Page, emails: string[]): Promise<string[]> {
  const prisma = await getPrisma();
  const campaignId = await createCampaign(page, "MEMORY");
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const version = await prisma.campaignVersion.create({
    data: { campaignId, versionNumber: 1, snapshot: {}, publishedById: campaign.ownerId },
  });
  const ids: string[] = [];
  for (const email of emails) {
    const participation = await prisma.participation.create({
      data: {
        campaignId,
        campaignVersionId: version.id,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
        email,
        firstName: "Titular",
        leadFormResponse: { email },
      },
    });
    ids.push(participation.id);
  }
  return ids;
}

test.describe("conservação e anonimização dos dados", () => {
  test("anonimizar uma lead selecionada na lista", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const version = await prisma.campaignVersion.create({
      data: { campaignId, versionNumber: 1, snapshot: {}, publishedById: campaign.ownerId },
    });
    const email = `titular-${uniqueSuffix()}@example.com`;
    const participation = await prisma.participation.create({
      data: {
        campaignId,
        campaignVersionId: version.id,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
        email,
        firstName: "Titular",
        leadFormResponse: { email },
      },
    });

    await page.goto(`/leads?campaignId=${campaignId}&period=all`);
    await page.waitForLoadState("networkidle");
    const row = page.locator("table tbody tr");
    await expect(row).toHaveCount(1);
    await expect(row.getByText(email)).toBeVisible();

    // Sem nada selecionado, o botão não abre o diálogo.
    await expect(page.getByRole("button", { name: /^Anonimizar selecionadas/ })).toBeDisabled();
    await row.getByRole("checkbox", { name: /Selecionar a lead de/ }).check();
    await page.getByRole("button", { name: "Anonimizar selecionadas (1)" }).click();
    const dialog = page.getByRole("dialog", { name: "Anonimizar 1 lead?" });
    await expect(dialog.getByText("Não é possível desfazer.", { exact: false })).toBeVisible();
    // Numa ação destrutiva, o foco começa em Cancelar.
    await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();
    await dialog.getByRole("button", { name: "Anonimizar", exact: true }).click();

    await expect(page.getByText("1 lead anonimizada.")).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("Anonimizada")).toBeVisible();
    await expect(row.getByText(email)).toHaveCount(0);
    await expect(row.getByRole("checkbox")).toBeDisabled();

    const saved = await prisma.participation.findUniqueOrThrow({ where: { id: participation.id } });
    expect(saved).toMatchObject({ email: null, firstName: null, leadFormResponse: {} });
    expect(saved.anonymizedAt).not.toBeNull();
  });

  test("exportar os dados de um titular a partir da lista de leads", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    const version = await prisma.campaignVersion.create({
      data: { campaignId, versionNumber: 1, snapshot: {}, publishedById: campaign.ownerId },
    });
    const email = `acesso-${uniqueSuffix()}@example.com`;
    const participation = await prisma.participation.create({
      data: {
        campaignId,
        campaignVersionId: version.id,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
        email,
        firstName: "Titular",
        leadFormResponse: { email },
      },
    });

    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    const exportButton = page.getByRole("button", { name: "Exportar os dados do titular" });
    // Sem identificador, a validação do browser trava o pedido.
    await exportButton.click();
    await expect(page.getByLabel("Pedido de um titular: e-mail ou telefone")).toBeFocused();

    await page.getByLabel("Pedido de um titular: e-mail ou telefone").fill(email.toUpperCase());
    const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
    expect(download.suggestedFilename()).toMatch(/^dados-titular-\d{4}-\d{2}-\d{2}\.json$/);
    const fs = await import("node:fs/promises");
    const file = JSON.parse(await fs.readFile((await download.path())!, "utf-8"));
    expect(file["Participações"]).toHaveLength(1);
    expect(file["Participações"][0]).toMatchObject({
      ID: participation.id,
      Identificação: { Nome: "Titular", "E-mail": email },
    });
    await expect(page.getByText("Ficheiro descarregado: 1 participação.")).toBeVisible();
    // O botão fica com o foco do princípio ao fim (aria-disabled, não disabled).
    await expect(exportButton).toBeFocused();
    // A exportação não apaga nada.
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: participation.id } })).email).toBe(email);
  });

  test("pedido de um titular: o campo tem largura e a exportação não se cruza com o formulário", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const email = `pedido-${uniqueSuffix()}@example.com`;
    const [participationId] = await subjectParticipations(page, [email]);

    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    const input = page.getByLabel("Pedido de um titular: e-mail ou telefone");
    const search = page.getByRole("button", { name: "Procurar", exact: true });
    const exportButton = page.getByRole("button", { name: "Exportar os dados do titular" });
    const subjectForm = page.locator("form", { has: input });

    // Com os três botões ao lado, o campo chegava a ~26 px em algumas larguras.
    for (const width of [320, 412, 700, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async () => (await input.boundingBox())?.width ?? 0, { message: `largura do campo a ${width}px` })
        .toBeGreaterThanOrEqual(200);
    }

    // Os envios do formulário (server actions) e os pedidos de exportação.
    const actionPosts: string[] = [];
    const exportPosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.headers()["next-action"]) actionPosts.push(request.url());
      if (new URL(request.url()).pathname === "/api/privacy/subject-export") exportPosts.push(request.url());
    });

    // Um erro de «Procurar» à vista…
    await input.fill("abc");
    await search.click();
    const searchError = page.getByText("Indique o e-mail ou o telefone completo do titular.");
    await expect(searchError).toBeVisible({ timeout: 10_000 });
    await expect(input).toHaveAttribute("aria-invalid", "true");

    // …desaparece quando a exportação começa: era de outro pedido.
    await input.fill(email);
    let releaseExport!: () => void;
    const exportGate = new Promise<void>((resolve) => (releaseExport = resolve));
    await page.route("**/api/privacy/subject-export", async (route) => {
      await exportGate;
      await route.continue();
    });
    await exportButton.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("A exportar os dados do titular…")).toBeVisible();
    await expect(exportButton).toHaveAttribute("aria-disabled", "true");
    await expect(exportButton).toBeFocused();
    await expect(searchError).toHaveCount(0);
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(input).not.toBeEditable();
    // Enquanto exporta, nem o «Procurar» nem um segundo Enter enviam nada.
    await expect(search).toHaveAttribute("aria-disabled", "true");
    const actionsBefore = actionPosts.length;
    await search.dispatchEvent("click");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    expect(actionPosts.length).toBe(actionsBefore);
    expect(exportPosts).toHaveLength(1);

    const [download] = await Promise.all([page.waitForEvent("download"), releaseExport()]);
    expect(download.suggestedFilename()).toMatch(/^dados-titular-.*\.json$/);
    await expect(page.getByText("Ficheiro descarregado: 1 participação.")).toBeVisible();
    await expect(exportButton).toBeFocused();
    await expect(exportButton).not.toHaveAttribute("aria-disabled", "true");
    await expect(input).toBeEditable();
    await page.unroute("**/api/privacy/subject-export");

    // Enviar o formulário apaga a mensagem da exportação; e enquanto ele
    // envia, «Exportar» não pede nada.
    let releaseAction!: () => void;
    const actionGate = new Promise<void>((resolve) => (releaseAction = resolve));
    await page.route(
      (url) => url.pathname === "/leads",
      async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["next-action"]) await actionGate;
        await route.continue();
      },
    );
    await search.click();
    await expect(page.getByText("Ficheiro descarregado: 1 participação.")).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-busy", "true");
    await expect(exportButton).toHaveAttribute("aria-disabled", "true");
    await exportButton.dispatchEvent("click");
    await page.waitForTimeout(300);
    expect(exportPosts).toHaveLength(1);
    releaseAction();
    // A resposta de «Procurar» (a contagem, cujo texto é do servidor).
    await expect(subjectForm.getByRole("status")).toBeVisible({ timeout: 10_000 });
    // O foco não caiu no <body> durante o envio.
    await expect(search).toBeFocused();
    await page.unroute((url) => url.pathname === "/leads");

    // Um identificador recusado pela exportação marca o campo, que aponta
    // para o erro; escrever outro limpa os dois.
    await input.fill("abc");
    await exportButton.click();
    const exportError = page.getByText("Indique o e-mail ou o telefone completo do titular.");
    await expect(exportError).toBeVisible();
    await expect(subjectForm.getByRole("status")).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    const errorId = await exportError.getAttribute("id");
    expect(errorId).toBeTruthy();
    await expect(input).toHaveAttribute("aria-describedby", `subject-help ${errorId}`);
    await input.fill(email);
    await expect(exportError).toHaveCount(0);
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "subject-help");
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: participationId! } })).anonymizedAt).toBeNull();
  });

  test("pedido de um titular: a mensagem conta o que o ficheiro leva", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const email = `contado-${uniqueSuffix()}@example.com`;
    const [participationId] = await subjectParticipations(page, [email]);
    // Outra pessoa indicou este e-mail numa resposta: é uma menção.
    const own = await prisma.participation.findUniqueOrThrow({ where: { id: participationId! } });
    const other = `outra-${uniqueSuffix()}@example.com`;
    await prisma.participation.create({
      data: {
        campaignId: own.campaignId,
        campaignVersionId: own.campaignVersionId,
        idempotencyKey: randomUUID(),
        status: "COMPLETED",
        email: other,
        leadFormResponse: { email: other, amigo: email },
      },
    });

    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    const input = page.getByLabel("Pedido de um titular: e-mail ou telefone");
    const exportButton = page.getByRole("button", { name: "Exportar os dados do titular" });
    let downloads = 0;
    page.on("download", () => downloads++);

    // O ficheiro verdadeiro: a participação do titular e a menção.
    await input.fill(email);
    const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
    const fs = await import("node:fs/promises");
    const file = JSON.parse(await fs.readFile((await download.path())!, "utf-8"));
    expect(file["Participações"]).toHaveLength(1);
    expect(file["Menções noutras participações"]).toHaveLength(1);
    await expect(page.getByText("Ficheiro descarregado: 1 participação e 1 menção noutra participação.")).toBeVisible();

    // O resto com respostas simuladas.
    const items = (count: number) => Array.from({ length: count }, () => ({}));
    let body = "";
    await page.route("**/api/privacy/subject-export", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        headers: { "Content-Disposition": 'attachment; filename="dados-titular-2026-01-01.json"' },
        body,
      }),
    );

    // As chaves do contrato do ficheiro, contadas no próprio ficheiro.
    body = JSON.stringify({
      "Sobre esta exportação": {},
      "Os seus direitos": {},
      Campanhas: [],
      Participações: items(2),
      "Menções noutras participações": items(1),
      "Dados antigos de participante": items(1),
    });
    await input.fill(`contagens-${uniqueSuffix()}@example.com`);
    await exportButton.click();
    await expect(
      page.getByText("Ficheiro descarregado: 2 participações, 1 menção noutra participação e 1 registo antigo."),
    ).toBeVisible();
    await expect.poll(() => downloads).toBe(2);

    body = JSON.stringify({
      "Sobre esta exportação": {},
      "Os seus direitos": {},
      Campanhas: [],
      Participações: [],
      "Menções noutras participações": [],
      "Dados antigos de participante": [],
    });
    await exportButton.click();
    await expect(
      page.getByText("Ficheiro descarregado: sem dados com este e-mail ou telefone (o ficheiro diz isso ao titular)."),
    ).toBeVisible();
    await expect.poll(() => downloads).toBe(3);

    // Um ficheiro cortado a meio é um erro e não se descarrega.
    body = '{\n  "Sobre esta exportação": {},\n  "Participações": [';
    await exportButton.click();
    await expect(page.getByText("o ficheiro chegou incompleto", { exact: false })).toBeVisible();
    await page.waitForTimeout(300);
    expect(downloads).toBe(3);
  });

  test("anonimizar os dados de um titular pede confirmação de cada vez", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const first = `primeiro-${uniqueSuffix()}@example.com`;
    const second = `segundo-${uniqueSuffix()}@example.com`;
    const [firstId, secondId] = await subjectParticipations(page, [first, second]);

    await page.goto("/leads");
    await page.waitForLoadState("networkidle");
    const input = page.getByLabel("Pedido de um titular: e-mail ou telefone");
    const anonymize = page.getByRole("button", { name: "Anonimizar os dados do titular" });
    const dialog = page.getByRole("dialog", { name: "Anonimizar os dados deste titular?" });

    await input.fill(first);
    await anonymize.click();
    await dialog.getByRole("button", { name: "Anonimizar", exact: true }).click();
    await expect(page.getByText("1 lead anonimizada.")).toBeVisible({ timeout: 10_000 });
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: firstId! } })).anonymizedAt).not.toBeNull();

    // O formulário não se remonta: antes, o segundo clique já não abria o
    // diálogo e anonimizava outra pessoa sem perguntar.
    await input.fill(second);
    await anonymize.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: secondId! } })).anonymizedAt).toBeNull();
  });

  test("definir o prazo de conservação da organização", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    const admin = await prisma.user.findUniqueOrThrow({
      where: { email: E2E_ADMIN_EMAIL },
      include: { memberships: true },
    });
    organizationId = admin.memberships[0]!.organizationId;
    originalRetention = (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).dataRetentionDays;

    await page.getByLabel("Prazo de conservação das leads").selectOption("365");
    await expect(page.getByText("A anonimização por este prazo começa daqui a 7 dias").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect
      .poll(async () => (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId! } })).dataRetentionDays)
      .toBe(365);
  });
});

test.afterAll(async () => {
  if (organizationId) {
    const prisma = await getPrisma();
    await prisma.organization.update({ where: { id: organizationId }, data: { dataRetentionDays: originalRetention } });
  }
  await disconnectPrisma();
});
