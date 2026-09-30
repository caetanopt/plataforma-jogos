-- Índices do passo 7 (performance). Só índices: não mexe em dados.
--
-- - Participation: listas e exportação de leads e estatísticas por período
--   (campaignId, createdAt, id) e, para a exportação de todas as campanhas,
--   (createdAt, id); controlo de duplicados por IP e sessão, dentro da
--   transação serializável; e as chaves estrangeiras participantId e
--   campaignVersionId (sem índice, apagar um participante percorria a tabela
--   inteira por cada linha: o SET NULL corre linha a linha).
-- - ConsentRecord.consentDefinitionId: filtro de marketing e "já aceite".
-- - PrizeAward.wheelSegmentId, PrizeCode (prizeId, status, createdAt).
-- - AuditLog: filtro por ação e vista global por data.
--
-- O Prisma corre a migração numa só transação, por isso cada CREATE INDEX
-- (sem CONCURRENTLY) bloqueia as escritas na sua tabela até ao fim da
-- migração inteira; as leituras continuam. Com tabelas grandes, criar antes
-- os índices com CREATE INDEX CONCURRENTLY (README, "Antes de fazer deploy"):
-- com IF NOT EXISTS, a migração passa por eles sem os refazer.
--
-- Os índices repetidos de User.email e Organization.slug saem na migração
-- seguinte, à parte: o DROP INDEX bloqueia também as leituras (login,
-- página pública) e, aqui, ficava bloqueado até todos os índices estarem
-- criados.
--
-- Sem conseguir um bloqueio em 5 s (uma transação longa a usar a tabela), a
-- migração falha em vez de pôr todas as queries seguintes em fila.
SET lock_timeout = '5s';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_action_createdAt_idx" ON "AuditLog"("organizationId", "action", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConsentRecord_consentDefinitionId_idx" ON "ConsentRecord"("consentDefinitionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_campaignId_createdAt_id_idx" ON "Participation"("campaignId", "createdAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_createdAt_id_idx" ON "Participation"("createdAt", "id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_participantId_idx" ON "Participation"("participantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_campaignVersionId_idx" ON "Participation"("campaignVersionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_campaignId_ipAddress_idx" ON "Participation"("campaignId", "ipAddress");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_campaignId_sessionId_idx" ON "Participation"("campaignId", "sessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrizeAward_wheelSegmentId_idx" ON "PrizeAward"("wheelSegmentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PrizeCode_prizeId_status_createdAt_idx" ON "PrizeCode"("prizeId", "status", "createdAt");
