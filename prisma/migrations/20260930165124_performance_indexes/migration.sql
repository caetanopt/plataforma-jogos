-- Índices do passo 7 (performance). Só índices: não mexe em dados.
--
-- - Participation: listas e exportação de leads e estatísticas por período
--   (campaignId, createdAt); controlo de duplicados por IP e sessão, dentro da
--   transação serializável; e as chaves estrangeiras participantId e
--   campaignVersionId (sem índice, apagar um participante percorria a tabela
--   inteira por cada linha: o SET NULL corre linha a linha).
-- - ConsentRecord.consentDefinitionId: filtro de marketing e "já aceite".
-- - PrizeAward.wheelSegmentId, PrizeCode (prizeId, status, createdAt).
-- - AuditLog: filtro por ação e vista global por data.
-- - Retira os índices repetidos de User.email e Organization.slug (os @unique
--   já criam um).
--
-- CREATE INDEX (sem CONCURRENTLY: o Prisma corre a migração numa transação)
-- bloqueia as escritas na tabela enquanto o índice é criado. Aplicar num
-- período com pouco tráfego.

-- DropIndex
DROP INDEX "Organization_slug_idx";

-- DropIndex
DROP INDEX "User_email_idx";

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_consentDefinitionId_idx" ON "ConsentRecord"("consentDefinitionId");

-- CreateIndex
CREATE INDEX "Participation_campaignId_createdAt_idx" ON "Participation"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Participation_participantId_idx" ON "Participation"("participantId");

-- CreateIndex
CREATE INDEX "Participation_campaignVersionId_idx" ON "Participation"("campaignVersionId");

-- CreateIndex
CREATE INDEX "Participation_campaignId_ipAddress_idx" ON "Participation"("campaignId", "ipAddress");

-- CreateIndex
CREATE INDEX "Participation_campaignId_sessionId_idx" ON "Participation"("campaignId", "sessionId");

-- CreateIndex
CREATE INDEX "PrizeAward_wheelSegmentId_idx" ON "PrizeAward"("wheelSegmentId");

-- CreateIndex
CREATE INDEX "PrizeCode_prizeId_status_createdAt_idx" ON "PrizeCode"("prizeId", "status", "createdAt");
