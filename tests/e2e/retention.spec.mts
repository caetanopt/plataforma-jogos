import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { createCampaign, E2E_ADMIN_EMAIL, loginAsAdmin, uniqueSuffix } from "./helpers";

/**
 * Conservação dos dados (§24): o administrador anonimiza uma lead a partir
 * da lista (com confirmação) e define o prazo da organização.
 */

let organizationId: string | null = null;
let originalRetention: number | null = null;

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
    // A exportação não apaga nada.
    expect((await prisma.participation.findUniqueOrThrow({ where: { id: participation.id } })).email).toBe(email);
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
