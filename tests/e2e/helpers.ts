import type { Page } from "@playwright/test";
import { Redis } from "ioredis";
import { Client } from "pg";
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./global-setup.mts";
import { rateLimitRedisKey } from "../../src/lib/security/rate-limit-key";

export { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD };

/**
 * O limite de login (10 por 15 minutos e por e-mail) também conta os logins
 * bem sucedidos, e a suite entra com a mesma conta em quase todos os testes:
 * a partir do décimo, os seguintes eram recusados. Cada login da suite começa
 * com o contador desta conta a zero (o teste de rate limit tem o seu próprio).
 */
export async function resetAdminLoginLimit(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 1 });
  try {
    await redis.del(rateLimitRedisKey(`login:${E2E_ADMIN_EMAIL}`));
  } finally {
    redis.disconnect();
  }
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await resetAdminLoginLimit();
  await page.goto("/login");
  await page.fill('input[name="email"]', E2E_ADMIN_EMAIL);
  await page.fill('input[name="password"]', E2E_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/folders/, { timeout: 15_000 });
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
  await setLegalText(match[1], E2E_LEGAL_TEXT);
  return match[1];
}

export const E2E_LEGAL_TEXT = "Os dados recolhidos servem apenas para gerir esta campanha de teste.";

/**
 * Um formulário que pede dados pessoais só se publica com o aviso de
 * privacidade (texto legal ou política de privacidade, ver readiness.ts):
 * cada campanha dos testes nasce com um texto legal, como uma real teria.
 * Direto na base de dados (pg): este ficheiro corre como CommonJS e não
 * pode carregar o cliente Prisma gerado (ver db.mts).
 */
export async function setLegalText(campaignId: string, legalText: string | null): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('UPDATE "Campaign" SET "legalText" = $1 WHERE "id" = $2', [legalText, campaignId]);
  } finally {
    await client.end();
  }
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
  // O CheckboxField acrescenta uma sentinela escondida com o mesmo nome.
  await li.locator('input[type="checkbox"][name="isCorrect"]').check();
  await li.getByRole("button", { name: "Adicionar resposta" }).click();
  await li.getByText(correctAnswer, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });

  await li.locator('input[name="text"]').fill(wrongAnswer);
  await li.getByRole("button", { name: "Adicionar resposta" }).click();
  await li.getByText(wrongAnswer, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
}

export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}
