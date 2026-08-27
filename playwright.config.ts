import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// O Playwright, ao contrário do Next.js, não carrega `.env` automaticamente —
// carregar aqui para que global-setup, specs e o `webServer` (npm run start)
// vejam DATABASE_URL/REDIS_URL/etc.
loadEnv();

// A revisão do Chromium pré-instalada no ambiente de desenvolvimento
// (chromium-1194) é mais antiga do que a que este @playwright/test pediria
// por omissão — aponta diretamente para o binário em vez de correr
// `playwright install`. Só existe nesse ambiente; noutros (ex.: CI, depois
// de `playwright install --with-deps chromium`), cai para a resolução
// normal do Playwright.
const sandboxChromiumPath = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const chromiumExecutablePath = existsSync(sandboxChromiumPath) ? sandboxChromiumPath : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.mts",
  // Execução sequencial: os testes partilham a mesma conta de admin semeada e o
  // mesmo rate limiter (Redis) — em paralelo, um teste poderia esgotar o
  // limite de tentativas de outro (ex.: login) de forma imprevisível.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  // Em CI, "html" fica gravado em disco (playwright-report/) para se poder
  // enviar como artefacto quando um teste falha — "list" (só terminal) não
  // deixa nada para inspecionar depois de o runner terminar.
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile-keyboard\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile-keyboard\.spec\.ts/ },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
