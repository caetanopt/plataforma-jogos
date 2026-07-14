-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "canExportLeads" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canPublish" BOOLEAN NOT NULL DEFAULT false;
