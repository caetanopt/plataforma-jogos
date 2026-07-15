import { test, expect } from "@playwright/test";
import { loginAsAdmin, createCampaign, publishCampaign, addQuizQuestionWithAnswers, uniqueSuffix } from "./helpers";

test.describe("Leads e exportação", () => {
  test("uma participação real aparece em /leads e a exportação CSV respeita o filtro de campanha", async ({
    page,
    context,
  }) => {
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

    await page.goto(`/leads?campaignId=${campaignId}&period=all`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar CSV" }).click(),
    ]);
    const csvPath = await download.path();
    expect(csvPath).toBeTruthy();

    const fs = await import("node:fs/promises");
    const content = await fs.readFile(csvPath!, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2); // cabeçalho + 1 linha de dados
    expect(lines[0]).toContain("Pontuação");
    expect(lines[1]).toContain("COMPLETED");
  });
});
