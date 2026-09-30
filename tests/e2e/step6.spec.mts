import { test, expect, type Page } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { createCampaign, E2E_LEGAL_TEXT, loginAsAdmin, publishCampaign, setLegalText, uniqueSuffix } from "./helpers";

/**
 * Passo 6 (RGPD): o jogo público usa o tema da campanha e mostra a
 * informação legal; sem aviso de privacidade, um formulário com dados
 * pessoais não se publica; a exportação traz os consentimentos.
 */

async function addLeadForm(campaignId: string, suffix: string) {
  const prisma = await getPrisma();
  await prisma.leadForm.update({
    where: { campaignId },
    data: {
      position: "BEFORE_GAME",
      fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
      consentDefinitions: {
        create: [{ text: `Aceito receber novidades ${suffix}`, isMarketing: true, required: false, order: 0 }],
      },
    },
  });
}

async function addMemoryPairs(campaignId: string, suffix: string) {
  const prisma = await getPrisma();
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
}

async function saveSettingsPrivacyContact(page: Page, email: string) {
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.fill("#privacyContactEmail", email);
  await expect(page.getByText("Alterações guardadas").first()).toBeVisible({ timeout: 10_000 });
}

let originalContact: string | null = null;
let organizationId: string | null = null;

test.describe("RGPD no jogo público", () => {
  test("o jogo usa as cores da campanha e mostra o texto legal, os links e o contacto de privacidade", async ({
    page,
  }) => {
    const prisma = await getPrisma();
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    organizationId = campaign.organizationId;
    originalContact =
      (await prisma.organization.findUniqueOrThrow({ where: { id: campaign.organizationId } })).privacyContactEmail;

    await addMemoryPairs(campaignId, suffix);
    await addLeadForm(campaignId, suffix);
    await prisma.campaignTheme.update({
      where: { id: campaign.themeId! },
      data: {
        buttonColor: "#8C1D18",
        buttonTextColor: "#FFFFFF",
        backgroundColor: "#FFF6D9",
        legalLinks: { privacyPolicyUrl: "https://marca.example/privacidade", termsUrl: "https://marca.example/termos" },
      },
    });
    const contact = `privacidade-${suffix}@example.com`;
    await saveSettingsPrivacyContact(page, contact);
    const slug = await publishCampaign(page, campaignId);

    const visitor = await (await page.context().browser()!.newContext()).newPage();
    await visitor.goto(`/play/${slug}`);
    await visitor.waitForLoadState("networkidle");

    const play = visitor.getByRole("button", { name: /Jogar/i });
    await expect(play).toHaveCSS("background-color", "rgb(140, 29, 24)");
    await expect(play).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(visitor.getByText(E2E_LEGAL_TEXT)).toBeVisible();
    // O jogo é o conteúdo principal; a informação legal é o rodapé da página.
    await expect(visitor.getByRole("main").getByRole("button", { name: /Jogar/i })).toBeVisible();
    const footer = visitor.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: /Termos e condições/ })).toHaveAttribute(
      "href",
      "https://marca.example/termos",
    );
    await expect(footer.getByRole("link", { name: contact })).toHaveAttribute("href", `mailto:${contact}`);

    await play.click();
    const leadForm = visitor.getByRole("form");
    await expect(leadForm.getByLabel("E-mail")).toBeVisible({ timeout: 10_000 });
    await expect(leadForm.getByRole("link", { name: /Política de privacidade/ })).toHaveAttribute(
      "href",
      "https://marca.example/privacidade",
    );
    await leadForm.getByText("Informação legal sobre o tratamento dos dados").click();
    await expect(leadForm.getByText(E2E_LEGAL_TEXT)).toBeVisible();
  });

  test("sem texto legal nem política de privacidade, um formulário com e-mail não se publica", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();
    await addMemoryPairs(campaignId, suffix);
    await addLeadForm(campaignId, suffix);
    await setLegalText(campaignId, null);

    await page.goto(`/apps/${campaignId}/publicar`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("O formulário de leads recolhe dados pessoais", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Publicar/ })).toBeDisabled();
  });

  test("a exportação de uma campanha traz o consentimento de marketing de cada lead", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "MEMORY");
    const suffix = uniqueSuffix();
    await addMemoryPairs(campaignId, suffix);
    await addLeadForm(campaignId, suffix);
    const slug = await publishCampaign(page, campaignId);

    const visitor = await (await page.context().browser()!.newContext()).newPage();
    await visitor.goto(`/play/${slug}`);
    await visitor.waitForLoadState("networkidle");
    await visitor.getByRole("button", { name: /Jogar/i }).click();
    await visitor.getByLabel("E-mail").fill(`lead-${suffix}@example.com`);
    await visitor.getByLabel(`Aceito receber novidades ${suffix}`).check();
    await visitor.getByRole("button", { name: "Continuar" }).click();
    await expect(visitor.locator("button.aspect-square").first()).toBeVisible({ timeout: 10_000 });

    await page.goto(`/leads?campaignId=${campaignId}&period=all&marketingConsent=granted`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.locator("table tbody tr").getByText("Concedido")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Exportar CSV" }).click(),
    ]);
    const fs = await import("node:fs/promises");
    const [header, line] = (await fs.readFile((await download.path())!, "utf-8")).trim().split("\n");
    expect(header).toContain("Consentimento de marketing");
    expect(header).toContain(`Consentimento: Aceito receber novidades ${suffix} (v1)`);
    expect(line).toContain(`lead-${suffix}@example.com`);
    expect(line).toContain(",Concedido,");
    // A última é "Anonimizada em", vazia.
    expect(line.endsWith(",Aceite,")).toBe(true);
  });
});

test.afterAll(async () => {
  if (organizationId) {
    const prisma = await getPrisma();
    await prisma.organization.update({ where: { id: organizationId }, data: { privacyContactEmail: originalContact } });
  }
  await disconnectPrisma();
});
