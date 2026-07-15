import { test, expect } from "@playwright/test";
import { loginAsAdmin, createCampaign, publishCampaign, uniqueSuffix } from "./helpers";

test.describe("Jogo da Memória", () => {
  test("criar, configurar, publicar e jogar como visitante regista uma participação real", async ({
    page,
    context,
  }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");

    await page.goto(`/apps/${campaignId}/jogo`);
    await page.waitForLoadState("networkidle");

    const suffix = uniqueSuffix();
    await page.selectOption("#kind", "TEXT_TEXT");
    for (let i = 0; i < 2; i += 1) {
      await page.fill('input[name="cardAText"]', `Par${i}-${suffix}`);
      await page.fill('input[name="cardBText"]', `Par${i}-${suffix}`);
      await page.getByRole("button", { name: "Adicionar par" }).click();
      await page.getByText(`Par${i}-${suffix}`, { exact: false }).first().waitFor({ state: "visible", timeout: 10_000 });
    }

    const slug = await publishCampaign(page, campaignId);

    const visitorPage = await context.browser()!.newContext().then((c) => c.newPage());
    await visitorPage.goto(`/play/${slug}`);
    await visitorPage.waitForLoadState("networkidle");
    await visitorPage.getByRole("button", { name: /Jogar/i }).click();
    await visitorPage.waitForTimeout(800);

    const continueBtn = visitorPage.getByRole("button", { name: "Continuar" });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await visitorPage.waitForTimeout(800);
    }

    const cards = visitorPage.locator("button.aspect-square");
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
    const total = await cards.count();

    async function clickPair(i: number, j: number): Promise<void> {
      await cards.nth(i).click();
      await visitorPage.waitForTimeout(150);
      await cards.nth(j).click();
      await visitorPage.waitForTimeout(900);
    }

    async function paresFound(): Promise<number> {
      // Ao encontrar o último par, o ecrã de resultado substitui o tabuleiro
      // (e o "Pares:") quase de imediato — nesse caso não há texto para ler,
      // mas isso já significa "todos os pares encontrados".
      const text = await visitorPage
        .getByText(/Pares:/)
        .textContent({ timeout: 3_000 })
        .catch(() => null);
      return text == null ? Number.POSITIVE_INFINITY : Number(text.match(/Pares:\s*(\d+)\//)?.[1] ?? 0);
    }

    // A grelha pode estar em ordem aleatória (secção 12 do CLAUDE.md), por
    // isso não se pode assumir que os cartões i/i+1 formam um par: tenta o
    // cartão 0 contra cada um dos restantes até encontrar o par por
    // eliminação, depois resolve o(s) par(es) remanescente(s) da mesma forma.
    const remaining = Array.from({ length: total }, (_, i) => i);
    while (remaining.length > 0) {
      const [first, ...rest] = remaining;
      let foundPartner: number | null = null;
      for (const candidate of rest) {
        const before = await paresFound();
        await clickPair(first, candidate);
        if ((await paresFound()) > before) {
          foundPartner = candidate;
          break;
        }
      }
      if (foundPartner == null) break;
      remaining.splice(remaining.indexOf(first), 1);
      remaining.splice(remaining.indexOf(foundPartner), 1);
    }

    await expect(visitorPage.getByText(/Pontuação/)).toBeVisible({ timeout: 10_000 });
  });
});
