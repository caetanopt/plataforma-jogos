import { test, expect } from "@playwright/test";
import { loginAsAdmin, createCampaign, publishCampaign, addQuizQuestionWithAnswers, uniqueSuffix } from "./helpers";

test.describe("Quiz Interativo", () => {
  test("criar, responder e calcular pontuação corretamente no servidor", async ({ page, context }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "QUIZ");
    const suffix = uniqueSuffix();

    await addQuizQuestionWithAnswers(page, campaignId, `Pergunta ${suffix}`, `Certa-${suffix}`, `Errada-${suffix}`);

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

    await visitorPage.getByRole("button", { name: `Certa-${suffix}`, exact: true }).click();
    await visitorPage.getByRole("button", { name: "Terminar" }).click();
    await visitorPage.waitForSelector("[aria-live='polite']", { timeout: 10_000 });
    await expect(visitorPage.locator("[aria-live='polite']")).toContainText("100%");
  });

  test("resposta errada obtém 0% (a pontuação nunca é calculada no cliente)", async ({ page, context }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "QUIZ");
    const suffix = uniqueSuffix();

    await addQuizQuestionWithAnswers(page, campaignId, `Pergunta ${suffix}`, `Certa-${suffix}`, `Errada-${suffix}`);
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

    await visitorPage.getByRole("button", { name: `Errada-${suffix}`, exact: true }).click();
    await visitorPage.getByRole("button", { name: "Terminar" }).click();
    await visitorPage.waitForSelector("[aria-live='polite']", { timeout: 10_000 });
    await expect(visitorPage.locator("[aria-live='polite']")).toContainText("0%");
  });
});
