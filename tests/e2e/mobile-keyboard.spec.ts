import { test, expect, devices } from "@playwright/test";
import {
  loginAsAdmin,
  createCampaign,
  publishCampaign,
  addQuizQuestionWithAnswers,
  uniqueSuffix,
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
} from "./helpers";

test.describe("Mobile e navegação por teclado", () => {
  test("jogar um Quiz publicado num viewport mobile", async ({ page, context }) => {
    // O backoffice não é otimizado para mobile (só a área pública de jogo o
    // é, conforme secção 32 do CLAUDE.md) — a preparação como admin usa uma
    // janela desktop; só o `visitorPage`, a seguir, testa o viewport mobile.
    await page.setViewportSize({ width: 1280, height: 800 });
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "QUIZ");
    const suffix = uniqueSuffix();
    await addQuizQuestionWithAnswers(page, campaignId, `Pergunta ${suffix}`, `Certa-${suffix}`, `Errada-${suffix}`);
    const slug = await publishCampaign(page, campaignId);

    const visitorContext = await context.browser()!.newContext(devices["Pixel 7"]);
    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`/play/${slug}`);
    await visitorPage.waitForLoadState("networkidle");

    const playButton = visitorPage.getByRole("button", { name: /Jogar/i });
    await expect(playButton).toBeVisible();
    // Confirma que o botão principal está dentro da largura do viewport mobile (sem overflow horizontal).
    const box = await playButton.boundingBox();
    const viewport = visitorPage.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);

    await playButton.click();
    await visitorPage.waitForTimeout(800);
    const continueBtn = visitorPage.getByRole("button", { name: "Continuar" });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await visitorPage.waitForTimeout(800);
    }
    await expect(visitorPage.getByRole("button", { name: `Certa-${suffix}`, exact: true })).toBeVisible();
  });

  test("login e submissão do formulário são possíveis apenas com teclado", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').focus();
    await page.keyboard.type(E2E_ADMIN_EMAIL);
    await page.keyboard.press("Tab");
    await page.keyboard.type(E2E_ADMIN_PASSWORD);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("navegação lateral do backoffice é operável apenas com teclado (foco visível)", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toBeVisible();
  });
});
