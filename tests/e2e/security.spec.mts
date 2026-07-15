import { test, expect } from "@playwright/test";
import { Redis } from "ioredis";
import { disconnectPrisma, getPrisma } from "./db.mts";
import { loginAsAdmin, E2E_ADMIN_EMAIL } from "./helpers";

test.describe("Segurança", () => {
  test("IDOR / isolamento multi-tenant: um admin não acede a uma campanha de outra organização", async ({
    page,
  }) => {
    const prisma = await getPrisma();
    const suffix = Date.now();
    const otherOrg = await prisma.organization.create({
      data: { name: `Outra Org ${suffix}`, slug: `outra-org-${suffix}` },
    });
    const theme = await prisma.campaignTheme.create({
      data: { organizationId: otherOrg.id, name: "Tema" },
    });
    const workspace = await prisma.workspace.create({
      data: { organizationId: otherOrg.id, name: "WS", slug: `ws-${suffix}` },
    });
    const foreignCampaign = await prisma.campaign.create({
      data: {
        organizationId: otherOrg.id,
        workspaceId: workspace.id,
        type: "MEMORY",
        internalName: "Campanha de outra organização",
        ownerId: (await prisma.user.findUniqueOrThrow({ where: { email: E2E_ADMIN_EMAIL } })).id,
        slug: `foreign-${suffix}`,
        themeId: theme.id,
      },
    });

    try {
      await loginAsAdmin(page);
      const response = await page.goto(`/apps/${foreignCampaign.id}/informacoes`);
      expect(response?.status()).toBe(404);
    } finally {
      await prisma.campaign.delete({ where: { id: foreignCampaign.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.campaignTheme.delete({ where: { id: theme.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    }
  });

  test("rate limiting: tentativas de login repetidas com password errada são bloqueadas", async ({ page }) => {
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    try {
      for (let i = 0; i < 11; i += 1) {
        await page.goto("/login");
        await page.fill('input[name="email"]', E2E_ADMIN_EMAIL);
        await page.fill('input[name="password"]', "password-errada-de-proposito");
        await page.click('button[type="submit"]');
        await page.waitForLoadState("networkidle");
      }
      // Mesmo com a password CERTA, o rate limit por e-mail deve continuar a bloquear.
      await page.goto("/login");
      await page.fill('input[name="email"]', E2E_ADMIN_EMAIL);
      await page.fill('input[name="password"]', process.env.E2E_ADMIN_PASSWORD ?? "E2eSuite!Passw0rd");
      await page.click('button[type="submit"]');
      await page.waitForLoadState("networkidle");
      await expect(page).not.toHaveURL(/\/dashboard/);
    } finally {
      // Repõe o limite para não afetar outros testes que ainda precisam de iniciar sessão.
      await redis.del(`ratelimit:login:${E2E_ADMIN_EMAIL}`);
      redis.disconnect();
    }
  });

  test("upload de SVG malicioso é sanitizado (script removido)", async ({ page, request }) => {
    await loginAsAdmin(page);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('xss')</script><circle cx="5" cy="5" r="4"/></svg>`;

    const response = await request.post("/api/uploads/svg", {
      headers: { cookie: cookieHeader },
      multipart: {
        file: {
          name: "malicious.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from(maliciousSvg),
        },
      },
    });

    expect(response.ok()).toBe(true);
    const body = await response.json();
    const uploaded = await fetch(body.url).then((r) => r.text());
    expect(uploaded).not.toContain("<script");
    expect(uploaded).not.toContain("alert(");
  });
});

test.afterAll(async () => {
  await disconnectPrisma();
});
