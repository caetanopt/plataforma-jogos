import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// O Playwright, ao contrário do Next.js, não carrega `.env` automaticamente —
// carregar aqui para que global-setup, specs e o `webServer` (npm run start)
// vejam DATABASE_URL/REDIS_URL/etc.
loadEnv();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.mts",
  // Execução sequencial: os testes partilham a mesma conta de admin semeada e o
  // mesmo rate limiter (Redis) — em paralelo, um teste poderia esgotar o
  // limite de tentativas de outro (ex.: login) de forma imprevisível.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // A revisão do Chromium pré-instalada no ambiente (chromium-1194) é mais
    // antiga do que a que este @playwright/test pediria por omissão — aponta
    // diretamente para o binário em vez de correr `playwright install`.
    launchOptions: { executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
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
