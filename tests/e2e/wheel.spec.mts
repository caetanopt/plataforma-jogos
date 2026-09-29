import { test, expect } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { loginAsAdmin, createCampaign, publishCampaign, uniqueSuffix } from "./helpers";

test.describe("Roda da Sorte", () => {
  test("criar, atribuir prémio, reduzir stock e bloquear uma segunda participação", async ({ page, context }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "WHEEL");
    const suffix = uniqueSuffix();

    await page.goto(`/apps/${campaignId}/jogo`);
    await page.waitForLoadState("networkidle");

    await page.locator("summary", { hasText: "Adicionar prémio" }).click();
    const prizeForm = page.locator("form", { has: page.getByRole("button", { name: "Adicionar prémio" }) });
    await prizeForm.locator('input[name="internalName"]').fill(`Prémio interno ${suffix}`);
    await prizeForm.locator('input[name="publicName"]').fill(`Prémio ${suffix}`);
    await prizeForm.locator('input[name="totalQuantity"]').fill("1");
    await prizeForm.getByRole("button", { name: "Adicionar prémio" }).click();
    await page.getByText(`Prémio ${suffix}`, { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });

    // Um único segmento ativo -> resultado sempre determinístico (sem depender de peso aleatório).
    const segmentForm = page.locator("form", { has: page.getByRole("button", { name: "Adicionar segmento" }) });
    await segmentForm.locator('input[name="name"]').fill(`Ganha ${suffix}`);
    await segmentForm.locator("select#outcome").selectOption("WIN");
    await segmentForm.locator('select#prizeId').selectOption({ label: `Prémio ${suffix}` });
    await segmentForm.getByRole("button", { name: "Adicionar segmento" }).click();
    await page.getByText(`Ganha ${suffix}`, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

    // Limite de uma participação -> repetir o pedido não pode atribuir um segundo prémio.
    await page.goto(`/apps/${campaignId}/regras`);
    await page.waitForLoadState("networkidle");
    await page.selectOption("#participationLimitType", "ONE_TOTAL");
    await page.waitForLoadState("networkidle");

    const slug = await publishCampaign(page, campaignId);

    const visitorContext = await context.browser()!.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`/play/${slug}`);
    await visitorPage.waitForLoadState("networkidle");
    await visitorPage.getByRole("button", { name: /Jogar/i }).click();
    await visitorPage.waitForTimeout(800);
    const continueBtn = visitorPage.getByRole("button", { name: "Continuar" });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await visitorPage.waitForTimeout(800);
    }

    await visitorPage.getByRole("button", { name: "Rodar a roda" }).click();
    await visitorPage.waitForSelector("[aria-live='polite']", { timeout: 10_000 });
    await expect(visitorPage.locator("[aria-live='polite']")).toContainText("ganhou");

    const prize = await prisma.prize.findFirst({ where: { campaignId, publicName: `Prémio ${suffix}` } });
    expect(prize?.awardedQuantity).toBe(1);
    expect(prize?.totalQuantity).toBe(1);

    // Recarregar o mesmo separador retoma a participação: mostra o prémio já
    // ganho, sem sortear de novo.
    await visitorPage.reload();
    await visitorPage.waitForLoadState("networkidle");
    await expect(visitorPage.getByText(`Prémio ${suffix}`)).toBeVisible({ timeout: 10_000 });

    // Outro separador com o mesmo cookie é uma tentativa nova: o limite recusa-a
    // e não atribui um segundo prémio.
    const secondTab = await visitorContext.newPage();
    await secondTab.goto(`/play/${slug}`);
    await secondTab.waitForLoadState("networkidle");
    await secondTab.getByRole("button", { name: /Jogar/i }).click();
    await expect(secondTab.getByText(/participou/)).toBeVisible({ timeout: 10_000 });

    const prizeAfterRetry = await prisma.prize.findFirst({ where: { id: prize!.id } });
    expect(prizeAfterRetry?.awardedQuantity).toBe(1);
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
