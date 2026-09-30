import "dotenv/config";
import { runDataRetention } from "../src/features/privacy/retention-job";
import { prisma } from "../src/server/db/client";

/**
 * Corre a tarefa de conservação dos dados à mão (a mesma do Vercel Cron):
 * `npm run privacy:retention`, com o DATABASE_URL da base de dados a tratar.
 * Imprime só contagens.
 */
async function main() {
  const summary = await runDataRetention({ timeBudgetMs: 30 * 60 * 1000 });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(`[retention] falhou (${error instanceof Error ? error.name : typeof error})`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
