import { test, expect } from "@playwright/test";
import { loginAsAdmin, createCampaign, uniqueSuffix } from "./helpers";

test.describe("Autosave do editor", () => {
  test("uma edição de texto feita mesmo antes de navegar para outra etapa não se perde", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");

    await page.goto(`/apps/${campaignId}/informacoes`);
    await page.waitForLoadState("networkidle");

    const newName = `Nome editado ${uniqueSuffix()}`;
    await page.fill("#internalName", newName);

    // Navega para outra etapa imediatamente a seguir à edição — bem dentro
    // da janela de debounce do autosave (900ms) — sem esperar que o
    // autosave dispare sozinho. Antes da correção, isto perdia a edição
    // silenciosamente: o temporizador pendente nunca era limpo nem
    // despoletado, e ao disparar mais tarde o formulário já estava
    // desmontado.
    await page.getByRole("link", { name: "Ecrã inicial" }).click();
    await page.waitForURL(/\/ecra-inicial/, { timeout: 15_000 });

    // O flush no desmonte é "fire-and-forget" (não bloqueia a navegação) —
    // tal como num browser real, o pedido continua em segundo plano depois
    // de a navegação terminar. Dar-lhe um instante para chegar ao servidor
    // antes de verificar, tal como aconteceria na prática.
    await page.waitForTimeout(1000);

    // Recarrega a etapa original a partir do servidor (não navegação
    // client-side) para confirmar que o valor foi mesmo persistido na BD.
    await page.goto(`/apps/${campaignId}/informacoes`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#internalName")).toHaveValue(newName);
  });
});
