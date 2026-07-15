import { test, expect } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { loginAsAdmin, createCampaign, publishCampaign, uniqueSuffix } from "./helpers";

test.describe("Modo de teste", () => {
  test("uma participação em modo de teste não consome stock nem conta para estatísticas", async ({ page }) => {
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

    const segmentForm = page.locator("form", { has: page.getByRole("button", { name: "Adicionar segmento" }) });
    await segmentForm.locator('input[name="name"]').fill(`Ganha ${suffix}`);
    await segmentForm.locator("select#outcome").selectOption("WIN");
    await segmentForm.locator("select#prizeId").selectOption({ label: `Prémio ${suffix}` });
    await segmentForm.getByRole("button", { name: "Adicionar segmento" }).click();
    await page.getByText(`Ganha ${suffix}`, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

    await publishCampaign(page, campaignId);

    // Mesmo contexto/sessão autenticada (admin) -> ?test=1 é honrado.
    await page.goto(`/apps/${campaignId}/publicar`);
    await page.waitForLoadState("networkidle");
    const linkCode = await page.locator("code").first().textContent();
    const slug = linkCode!.trim().split("/play/")[1];

    await page.goto(`/play/${slug}?test=1`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Modo de teste")).toBeVisible();

    await page.getByRole("button", { name: /Jogar/i }).click();
    await page.waitForTimeout(800);
    const continueBtn = page.getByRole("button", { name: "Continuar" });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(800);
    }
    await page.getByRole("button", { name: "Rodar a roda" }).click();
    await page.waitForSelector("[aria-live='polite']", { timeout: 10_000 });

    const prize = await prisma.prize.findFirst({ where: { campaignId, publicName: `Prémio ${suffix}` } });
    expect(prize?.awardedQuantity).toBe(0);

    const participation = await prisma.participation.findFirst({
      where: { campaignId },
      orderBy: { createdAt: "desc" },
    });
    expect(participation?.isTest).toBe(true);

    const prizeAward = await prisma.prizeAward.findFirst({ where: { participationId: participation!.id } });
    expect(prizeAward).toBeNull();
  });

  test("um visitante anónimo (sem sessão) não consegue ativar o modo de teste via ?test=1", async ({ page, context }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();

    await page.goto(`/apps/${campaignId}/jogo`);
    await page.waitForLoadState("networkidle");
    await page.selectOption("#kind", "TEXT_TEXT");
    // A publicação exige pelo menos 2 pares (ver getPublishReadiness).
    for (let i = 0; i < 2; i += 1) {
      await page.fill('input[name="cardAText"]', `Par${i}-${suffix}`);
      await page.fill('input[name="cardBText"]', `Par${i}-${suffix}`);
      await page.getByRole("button", { name: "Adicionar par" }).click();
      await page.getByText(`Par${i}-${suffix}`, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
    }

    const slug = await publishCampaign(page, campaignId);

    const visitorContext = await context.browser()!.newContext();
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`/play/${slug}?test=1`);
    await visitorPage.waitForLoadState("networkidle");
    // Sem sessão de admin -> não deve mostrar o aviso de modo de teste.
    await expect(visitorPage.getByText("Modo de teste")).toHaveCount(0);
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
