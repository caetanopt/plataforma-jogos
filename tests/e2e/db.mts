import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";

let client: PrismaClient | null = null;

/**
 * Ficheiro `.mts`: o cliente Prisma gerado usa `import.meta.url` a nível de
 * módulo, pelo que só pode ser carregado como ESM nativo. Ficheiros `.ts`
 * normais são transpilados para CommonJS pelo runner do Playwright e falham
 * com "Cannot use 'import.meta' outside a module".
 */
export async function getPrisma(): Promise<PrismaClient> {
  if (!client) {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
