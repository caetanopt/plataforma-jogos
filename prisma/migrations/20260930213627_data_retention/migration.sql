-- Conservação dos dados (§24): prazo por campanha (a organização já tinha
-- "dataRetentionDays", por usar), quando cada prazo mudou (a anonimização só
-- começa 7 dias depois, para dar tempo de exportar) e a marca das
-- participações anonimizadas. Só colunas novas, todas opcionais: sem prazo
-- definido, nada muda.
--
-- Idempotente: o Prisma confirma cada instrução à parte, e uma migração que
-- falhe a meio tem de poder correr outra vez.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "dataRetentionChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "dataRetentionDays" INTEGER,
ADD COLUMN IF NOT EXISTS "dataRetentionUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "dataRetentionChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3);

-- Um prazo em dias é sempre positivo (a aplicação só oferece 30, 90, 180 e
-- 365; qualquer outro valor chegado aqui é um erro).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Organization_dataRetentionDays_positive') THEN
    ALTER TABLE "Organization" ADD CONSTRAINT "Organization_dataRetentionDays_positive"
      CHECK ("dataRetentionDays" IS NULL OR "dataRetentionDays" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_dataRetentionDays_positive') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dataRetentionDays_positive"
      CHECK ("dataRetentionDays" IS NULL OR "dataRetentionDays" > 0);
  END IF;
END $$;
