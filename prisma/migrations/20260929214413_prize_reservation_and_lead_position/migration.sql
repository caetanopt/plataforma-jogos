-- CreateEnum
CREATE TYPE "PrizeAwardStatus" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "PrizeReleaseReason" AS ENUM ('EXPIRED', 'DUPLICATE', 'BOT');

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "leadFormPosition" "LeadFormPosition";

-- AlterTable
ALTER TABLE "PrizeAward" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "releaseReason" "PrizeReleaseReason",
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "reservationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "status" "PrizeAwardStatus" NOT NULL DEFAULT 'CONFIRMED';

-- CreateIndex
CREATE INDEX "PrizeAward_prizeId_status_reservationExpiresAt_idx" ON "PrizeAward"("prizeId", "status", "reservationExpiresAt");

-- CreateIndex
CREATE INDEX "PrizeAward_prizeId_status_awardedAt_idx" ON "PrizeAward"("prizeId", "status", "awardedAt");

-- Os prémios atribuídos antes desta migração foram entregues no momento do
-- sorteio: ficam confirmados nesse instante.
UPDATE "PrizeAward" SET "confirmedAt" = "awardedAt" WHERE "confirmedAt" IS NULL;
