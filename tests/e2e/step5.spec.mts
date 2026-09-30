import { test, expect, type Page } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { addQuizQuestionWithAnswers, createCampaign, loginAsAdmin, publishCampaign, uniqueSuffix } from "./helpers";

/**
 * Passo 5: o editor diz a verdade sobre o que gravou, a roda só entrega o
 * código depois da lead, e recarregar a página retoma a participação.
 */

async function waitSaved(page: Page) {
  await expect(page.getByText("Alterações guardadas").first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Editor: gravação honesta", () => {
  test("um link inválido mostra o erro no campo e o resto do ecrã grava", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();

    await page.goto(`/apps/${campaignId}/ecra-final`);
    await page.waitForLoadState("networkidle");
    await page.fill("#finalTitle", `Obrigado ${suffix}`);
    await page.fill("#finalCtaUrl", "javascript:alert(1)");

    const error = page.getByText("Link do botão de ação: tem de começar por https:// ou http://.");
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#finalCtaUrl")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Algumas alterações não foram guardadas.")).toBeVisible();
    // O texto escrito continua no campo (antes, o reset do formulário apagava-o).
    await expect(page.locator("#finalCtaUrl")).toHaveValue("javascript:alert(1)");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#finalTitle")).toHaveValue(`Obrigado ${suffix}`);
    await expect(page.locator("#finalCtaUrl")).toHaveValue("");
  });

  test("editar um campo do formulário de leads fica gravado", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();

    await page.goto(`/apps/${campaignId}/formulario`);
    await page.waitForLoadState("networkidle");
    await page.selectOption("#newFieldType", "EMAIL");
    await page.fill("#newFieldLabel", `E-mail ${suffix}`);
    await page.getByRole("button", { name: "Adicionar campo" }).click();
    await expect(page.getByText(`E-mail ${suffix}`, { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    const row = page.locator("li", { hasText: `E-mail ${suffix}` }).first();
    await row.locator("summary").filter({ hasText: "Editar" }).click();
    const label = row.getByLabel("Label", { exact: true });
    await label.fill(`Endereço ${suffix}`);
    await waitSaved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(`Endereço ${suffix}`, { exact: true }).first()).toBeVisible();
  });

  test("desligar o ecrã intermédio esconde-o sem apagar o conteúdo", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();

    await page.goto(`/apps/${campaignId}/ecra-intermedio`);
    await page.waitForLoadState("networkidle");
    const screenForm = () =>
      page.locator("form", { has: page.locator('input[name="kind"][value="INTERMEDIATE_BEFORE"]') });
    const section = screenForm();
    await section.locator('input[type="checkbox"][name="enabled"]').check();
    await waitSaved(page);
    await section.locator('input[name="title"]').fill(`Antes ${suffix}`);
    await waitSaved(page);
    await section.locator('input[type="checkbox"][name="enabled"]').uncheck();
    await waitSaved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    const reloaded = screenForm();
    await expect(reloaded.locator('input[type="checkbox"][name="enabled"]')).not.toBeChecked();
    await expect(reloaded.locator('input[name="title"]')).toHaveValue(`Antes ${suffix}`);
  });

  test("uma imagem que demora a carregar fica gravada quando o upload termina", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");

    // Mais lento do que os 900 ms da gravação automática: antes, a gravação
    // disparava a meio do upload, com o id antigo, e a imagem perdia-se.
    await page.route("**/api/uploads/svg", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });

    await page.goto(`/apps/${campaignId}/ecra-inicial`);
    await page.waitForLoadState("networkidle");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#002E5D"/></svg>';
    const logoField = page.locator("div", { has: page.getByText("Logótipo", { exact: true }) }).last();
    await logoField
      .locator('input[type="file"]')
      .setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });

    await expect(page.getByText("A carregar ficheiro…")).toBeVisible();
    await waitSaved(page);

    // Espera pelo elemento e não por "networkidle": com os workers em
    // paralelo, a rede do backoffice nem sempre fica parada 500 ms.
    await page.reload();
    await expect(page.getByAltText("Pré-visualização de Logótipo")).toBeVisible({ timeout: 15_000 });
    const prisma = await getPrisma();
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.startLogoMediaId).not.toBeNull();
  });
});

test.describe("Jogo público", () => {
  test("roda com o formulário depois do jogo: o código só aparece depois da lead", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "WHEEL");
    const suffix = uniqueSuffix();

    const prize = await prisma.prize.create({
      data: { campaignId, internalName: `Interno ${suffix}`, publicName: `Prémio ${suffix}`, totalQuantity: 5 },
    });
    await prisma.prizeCode.create({ data: { prizeId: prize.id, code: `CODE-${suffix}` } });
    const wheelConfig = await prisma.wheelConfig.findUniqueOrThrow({ where: { campaignId } });
    await prisma.wheelSegment.create({
      data: { wheelConfigId: wheelConfig.id, order: 0, name: `Ganha ${suffix}`, colorHex: "#00AEEF", outcome: "WIN", prizeId: prize.id },
    });
    await prisma.leadForm.update({
      where: { campaignId },
      data: {
        position: "AFTER_GAME",
        fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
      },
    });
    const slug = await publishCampaign(page, campaignId);

    const visitor = await (await page.context().browser()!.newContext()).newPage();
    await visitor.goto(`/play/${slug}`);
    await visitor.waitForLoadState("networkidle");
    await visitor.getByRole("button", { name: /Jogar/i }).click();
    await visitor.getByRole("button", { name: "Rodar a roda" }).click();

    const wheelResult = visitor.locator("[aria-live='polite']");
    await expect(wheelResult).toContainText(`Prémio ${suffix}`, { timeout: 10_000 });
    await expect(wheelResult).toContainText("para receber o código");
    await expect(visitor.getByText(`CODE-${suffix}`)).toHaveCount(0);
    const reserved = await prisma.prizeAward.findFirstOrThrow({ where: { prizeId: prize.id } });
    expect(reserved.status).toBe("RESERVED");

    await visitor.getByRole("button", { name: "Continuar" }).click();
    await visitor.getByLabel("E-mail").fill(`roda-${suffix}@example.com`);
    await visitor.getByRole("button", { name: "Continuar" }).click();

    await expect(visitor.getByText("O seu prémio")).toBeVisible({ timeout: 10_000 });
    await expect(visitor.getByText(`CODE-${suffix}`)).toBeVisible();
    const confirmed = await prisma.prizeAward.findFirstOrThrow({ where: { prizeId: prize.id } });
    expect(confirmed.status).toBe("CONFIRMED");
  });

  test("recarregar a página a meio retoma a mesma participação", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();
    const memoryConfig = await prisma.memoryGameConfig.findUniqueOrThrow({ where: { campaignId } });
    await prisma.memoryCardPair.createMany({
      data: [0, 1].map((order) => ({
        memoryGameConfigId: memoryConfig.id,
        order,
        kind: "TEXT_TEXT" as const,
        cardAText: `Par${order}-${suffix}`,
        cardBText: `Par${order}-${suffix}`,
      })),
    });
    await prisma.campaign.update({ where: { id: campaignId }, data: { participationLimitType: "ONE_TOTAL" } });
    const slug = await publishCampaign(page, campaignId);

    const visitor = await (await page.context().browser()!.newContext()).newPage();
    await visitor.goto(`/play/${slug}`);
    await visitor.waitForLoadState("networkidle");
    await visitor.getByRole("button", { name: /Jogar/i }).click();
    await expect(visitor.locator("button.aspect-square").first()).toBeVisible({ timeout: 10_000 });

    await visitor.reload();
    await visitor.waitForLoadState("networkidle");
    // Com "uma participação total", antes o F5 dava "Já participou".
    await expect(visitor.getByText("Retomámos a sua participação.")).toBeVisible({ timeout: 10_000 });
    await expect(visitor.locator("button.aspect-square").first()).toBeVisible();
    expect(await prisma.participation.count({ where: { campaignId, isTest: false } })).toBe(1);
  });
});

test.describe("Jogo público retomado", () => {
  test("quiz com o resultado retido: recarregar no formulário mostra o resultado depois da lead", async ({ page }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "QUIZ");
    const suffix = uniqueSuffix();
    await addQuizQuestionWithAnswers(page, campaignId, `Pergunta ${suffix}`, `Certa-${suffix}`, `Errada-${suffix}`);
    await prisma.leadForm.update({
      where: { campaignId },
      data: {
        position: "BEFORE_RESULT",
        fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
      },
    });
    const slug = await publishCampaign(page, campaignId);

    const visitor = await (await page.context().browser()!.newContext()).newPage();
    await visitor.goto(`/play/${slug}`);
    await visitor.waitForLoadState("networkidle");
    await visitor.getByRole("button", { name: /Jogar/i }).click();
    await visitor.getByRole("button", { name: `Certa-${suffix}`, exact: true }).click();
    await visitor.getByRole("button", { name: "Terminar" }).click();
    await expect(visitor.getByText("O seu resultado está pronto.", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Recarregar no formulário: antes, a lead era aceite e o resultado nunca aparecia.
    await visitor.reload();
    await visitor.waitForLoadState("networkidle");
    await expect(visitor.getByText("Retomámos a sua participação.")).toBeVisible({ timeout: 10_000 });
    await expect(visitor.getByText("O seu resultado está pronto.", { exact: false })).toBeVisible();
    await expect(visitor.getByText("100%")).toHaveCount(0);
    await visitor.getByLabel("E-mail").fill(`retoma-${suffix}@example.com`);
    await visitor.getByRole("button", { name: "Continuar" }).click();

    await expect(visitor.getByText("100% (", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Num dispositivo partilhado, o ecrã final retomado deixa passar à pessoa seguinte.
    await visitor.getByRole("button", { name: "Começar uma nova participação" }).click();
    await visitor.waitForLoadState("networkidle");
    await expect(visitor.getByRole("button", { name: /Jogar/i })).toBeEnabled({ timeout: 10_000 });
    await expect(visitor.getByText("Retomámos a sua participação.")).toHaveCount(0);
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
