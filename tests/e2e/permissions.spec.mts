import { randomBytes, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { E2E_ORG_SLUG } from "./global-setup.mts";

/**
 * Link de reposição com o token no fragmento (nunca chega ao servidor) e o
 * que um Visualizador vê: sem "Leads" na navegação e sem acesso ao editor.
 */
test.describe("Reposição de password e papel de Visualizador", () => {
  test("define a password pelo link #t=..., entra e é recusado no editor", async ({ page }) => {
    const prisma = await getPrisma();
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: E2E_ORG_SLUG } });
    const workspace = await prisma.workspace.findFirstOrThrow({ where: { organizationId: organization.id } });
    const suffix = randomUUID().slice(0, 8);
    const email = `viewer-${suffix}@example.test`;
    const password = `Viewer-${suffix}-Passw0rd`;

    const user = await prisma.user.create({
      data: { name: "Visualizador", email, passwordHash: "por-definir", emailVerifiedAt: new Date() },
    });
    await prisma.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "VIEWER" } });
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        type: "WHEEL",
        internalName: `Roda ${suffix}`,
        ownerId: user.id,
        slug: `viewer-${suffix}`,
        wheelConfig: { create: {} },
      },
    });
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    try {
      await page.goto(`/reset-password#t=${token}`);
      await page.waitForLoadState("networkidle");
      // O token sai da barra de endereço assim que o formulário o lê.
      expect(page.url()).not.toContain(token);

      await page.fill("#password", password);
      await page.fill("#confirmPassword", password);
      await page.getByRole("button", { name: "Guardar password" }).click();
      await page.waitForURL(/\/login\?reset=success/, { timeout: 15_000 });

      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/folders/, { timeout: 15_000 });

      const nav = page.getByRole("navigation", { name: "Navegação principal" }).first();
      await expect(nav.getByRole("link", { name: "Estatísticas" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Leads" })).toHaveCount(0);

      await page.goto(`/apps/${campaign.id}/jogo`);
      await expect(page.getByText("Não tem permissão para abrir esta página")).toBeVisible();

      await page.goto("/leads");
      await expect(page.getByText("Não tem permissão para abrir esta página")).toBeVisible();

      const used = await prisma.passwordResetToken.findUniqueOrThrow({ where: { token } });
      expect(used.usedAt).not.toBeNull();
    } finally {
      await prisma.wheelConfig.deleteMany({ where: { campaignId: campaign.id } });
      await prisma.campaign.delete({ where: { id: campaign.id } });
      await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
