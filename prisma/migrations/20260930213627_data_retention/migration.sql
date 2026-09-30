-- Conservação dos dados (§24): prazo por campanha (a organização já tinha
-- "dataRetentionDays", por usar) e a marca das participações anonimizadas.
-- Só colunas novas, todas opcionais: sem prazo definido, nada muda.

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "dataRetentionDays" INTEGER,
ADD COLUMN     "dataRetentionUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

-- Um prazo em dias é sempre positivo (a aplicação só oferece 30, 90, 180 e
-- 365; qualquer outro valor chegado aqui é um erro).
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_dataRetentionDays_positive" CHECK ("dataRetentionDays" IS NULL OR "dataRetentionDays" > 0);
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_dataRetentionDays_positive" CHECK ("dataRetentionDays" IS NULL OR "dataRetentionDays" > 0);
