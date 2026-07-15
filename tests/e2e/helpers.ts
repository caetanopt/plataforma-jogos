import type { Page } from "@playwright/test";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./global-setup.mts";

export { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD };

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_ADMIN_EMAIL);
  await page.fill('input[name="password"]', E2E_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
}

export async function createCampaign(
  page: Page,
  type: "MEMORY" | "WHEEL" | "QUIZ",
): Promise<string> {
  await page.goto("/apps/new");
  await page.waitForLoadState("networkidle");
  const form = page.locator("form", { has: page.locator(`input[name="type"][value="${type}"]`) });
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/apps\/[^/]+\/informacoes/, { timeout: 15_000 });
  const match = page.url().match(/apps\/([^/]+)\//);
  if (!match) throw new Error("Não foi possível extrair o ID da campanha criada.");
  return match[1];
}

export async function publishCampaign(page: Page, campaignId: string): Promise<string> {
  await page.goto(`/apps/${campaignId}/publicar`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^(Publicar|Republicar)/ }).click();
  await page.waitForLoadState("networkidle");
  const linkCode = await page.locator("code").first().textContent();
  const slug = linkCode?.trim().split("/play/")[1];
  if (!slug) throw new Error("Não foi possível obter o slug público após publicar.");
  return slug;
}

export async function addQuizQuestionWithAnswers(
  page: Page,
  campaignId: string,
  title: string,
  correctAnswer: string,
  wrongAnswer: string,
): Promise<void> {
  await page.goto(`/apps/${campaignId}/jogo`);
  await page.waitForLoadState("networkidle");
  await page.selectOption("#type", "SINGLE_CHOICE");
  await page.fill("#title", title);
  await page.getByRole("button", { name: "Adicionar pergunta" }).click();
  await page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

  await page.locator("summary", { hasText: "Editar pergunta e respostas" }).first().click();
  const li = page
    .locator("li", { has: page.locator("summary", { hasText: "Editar pergunta e respostas" }) })
    .first();

  await li.locator('input[name="text"]').fill(correctAnswer);
  await li.locator('input[name="isCorrect"]').check();
  await li.getByRole("button", { name: "Adicionar resposta" }).click();
  await li.getByText(correctAnswer, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

  await li.locator('input[name="text"]').fill(wrongAnswer);
  await li.getByRole("button", { name: "Adicionar resposta" }).click();
  await li.getByText(wrongAnswer, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}
