import { test, expect, type Page } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { addQuizQuestionWithAnswers, createCampaign, loginAsAdmin, publishCampaign, uniqueSuffix } from "./helpers";

/**
 * Posições do formulário de leads que retêm o resultado (secção 11). O
 * servidor só envia o que pode ser mostrado; estes testes confirmam que o
 * ecrã acompanha: formulário no momento certo e revelação depois dele.
 */

async function configureLeadForm(campaignId: string, position: "BEFORE_RESULT" | "BEFORE_PRIZE") {
  const prisma = await getPrisma();
  // Cada campanha nasce com um formulário vazio antes do jogo.
  const leadForm = await prisma.leadForm.update({
    where: { campaignId },
    data: {
      position,
      fields: { create: [{ type: "EMAIL", internalKey: "email", label: "E-mail", required: true, order: 0 }] },
      consentDefinitions: { create: [{ text: "Aceito o regulamento", required: true, order: 0 }] },
    },
  });
  return leadForm;
}

async function openAsVisitor(page: Page, slug: string): Promise<Page> {
  const visitorContext = await page.context().browser()!.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/play/${slug}`);
  await visitor.waitForLoadState("networkidle");
  await visitor.getByRole("button", { name: /Jogar/i }).click();
  return visitor;
}

async function fillLead(visitor: Page, email: string, submit: string) {
  await visitor.getByLabel("E-mail").fill(email);
  await visitor.getByLabel("Aceito o regulamento").check();
  await visitor.getByRole("button", { name: submit }).click();
}

test.describe("Formulário de leads antes da revelação", () => {
  test("roda: 'antes do prémio' mostra que ganhou e só revela o prémio depois do formulário", async ({ page }) => {
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
      data: {
        wheelConfigId: wheelConfig.id,
        order: 0,
        name: `Ganha ${suffix}`,
        colorHex: "#00AEEF",
        outcome: "WIN",
        prizeId: prize.id,
      },
    });
    await configureLeadForm(campaignId, "BEFORE_PRIZE");
    const slug = await publishCampaign(page, campaignId);

    const visitor = await openAsVisitor(page, slug);
    await visitor.getByRole("button", { name: "Rodar a roda" }).click();

    const wheelResult = visitor.locator("[aria-live='polite']");
    await expect(wheelResult).toContainText("ganhou", { timeout: 10_000 });
    await expect(wheelResult).toContainText("Preencha os seus dados");
    await expect(visitor.getByText(`Prémio ${suffix}`)).toHaveCount(0);

    await visitor.getByRole("button", { name: "Continuar" }).click();
    await expect(visitor.getByText("Preencha os seus dados para receber o prémio.")).toBeVisible();
    await fillLead(visitor, `lead-${suffix}@example.com`, "Continuar");

    await expect(visitor.getByText("O seu prémio")).toBeVisible({ timeout: 10_000 });
    await expect(visitor.getByText(`Prémio ${suffix}`)).toBeVisible();
    await expect(visitor.getByText(`CODE-${suffix}`)).toBeVisible();

    const participation = await prisma.participation.findFirstOrThrow({ where: { campaignId, isTest: false } });
    expect(participation.email).toBe(`lead-${suffix}@example.com`);
  });

  test("quiz: 'antes do resultado' pede o formulário ao terminar e só depois mostra a pontuação", async ({ page }) => {
    await loginAsAdmin(page);
    const campaignId = await createCampaign(page, "QUIZ");
    const suffix = uniqueSuffix();

    await addQuizQuestionWithAnswers(page, campaignId, `Pergunta ${suffix}`, `Certa-${suffix}`, `Errada-${suffix}`);
    await configureLeadForm(campaignId, "BEFORE_RESULT");
    const slug = await publishCampaign(page, campaignId);

    const visitor = await openAsVisitor(page, slug);
    await visitor.getByRole("button", { name: `Certa-${suffix}`, exact: true }).click();
    await visitor.getByRole("button", { name: "Terminar" }).click();

    await expect(visitor.getByText("O seu resultado está pronto.", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(visitor.getByText("100%")).toHaveCount(0);

    await fillLead(visitor, `quiz-${suffix}@example.com`, "Ver o resultado");
    await expect(visitor.locator("[aria-live='polite']").filter({ hasText: "100%" })).toBeVisible({ timeout: 10_000 });
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
