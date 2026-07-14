-- CreateIndex
CREATE UNIQUE INDEX "Participant_organizationId_cookieId_key" ON "Participant"("organizationId", "cookieId");
