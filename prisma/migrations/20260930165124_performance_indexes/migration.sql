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
-- O Prisma confirma cada instrução à parte (não é uma transação única): cada
-- CREATE INDEX (sem CONCURRENTLY) bloqueia as escritas na sua tabela só
-- enquanto corre; as leituras continuam. Se a migração falhar a meio, os
-- índices já criados ficam, e o IF NOT EXISTS deixa-a correr outra vez. Com
-- tabelas grandes, criar antes os índices com CREATE INDEX CONCURRENTLY
-- (README, "Antes de fazer deploy"): a migração passa por eles sem os refazer,
-- desde que sejam válidos (ver o bloco abaixo).
--
-- Os índices repetidos de User.email e Organization.slug saem na migração
-- seguinte, à parte: o DROP INDEX bloqueia também as leituras (login,
-- página pública).
--
-- Sem conseguir um bloqueio em 5 s (uma transação longa a usar a tabela), a
-- migração falha em vez de pôr todas as queries seguintes em fila. O valor
-- vale para a sessão do `migrate deploy`: volta ao normal no fim.
SET lock_timeout = '5s';

-- Um CREATE INDEX CONCURRENTLY interrompido deixa um índice com este nome
-- marcado como inválido: o IF NOT EXISTS passava por ele em silêncio, e o
-- índice nunca era usado. Falha aqui, com o nome, para ser apagado e criado
-- de novo.
DO $$
DECLARE invalid text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO invalid
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  WHERE NOT i.indisvalid AND c.relname IN (
    'AuditLog_organizationId_action_createdAt_idx', 'AuditLog_createdAt_idx',
    'ConsentRecord_consentDefinitionId_idx', 'Participation_campaignId_createdAt_id_idx',
    'Participation_createdAt_id_idx', 'Participation_participantId_idx',
    'Participation_campaignVersionId_idx', 'Participation_campaignId_ipAddress_idx',
    'Participation_campaignId_sessionId_idx', 'PrizeAward_wheelSegmentId_idx',
    'PrizeCode_prizeId_status_createdAt_idx'
  );
  IF invalid IS NOT NULL THEN
    RAISE EXCEPTION 'Índices inválidos (CREATE INDEX CONCURRENTLY interrompido): %. Apagar com DROP INDEX CONCURRENTLY e criar de novo.', invalid;
  END IF;
END $$;

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

RESET lock_timeout;
