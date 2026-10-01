-- Índice parcial das participações que ainda têm dados pessoais (§24), por
-- campanha e data. A tarefa diária da conservação lê-as das mais antigas para
-- as mais recentes; pelo índice (campaignId, createdAt, id) passava primeiro
-- por todas as já anonimizadas, que são as mais antigas, em cada lote de cada
-- execução (com 120 mil anonimizadas, ~275 ms por lote em vez de ~1 ms). Os
-- avisos e a contagem "por anonimizar" da lista de leads também o usam.
--
-- Só um índice: não mexe em dados. O CREATE INDEX (sem CONCURRENTLY)
-- bloqueia as escritas em "Participation" enquanto corre; as leituras
-- continuam. Numa tabela grande, criá-lo antes com CONCURRENTLY (README,
-- "Antes de fazer deploy"): a migração passa por ele, desde que seja válido.
SET lock_timeout = '5s';

-- Um CREATE INDEX CONCURRENTLY interrompido deixa o índice inválido, e o IF
-- NOT EXISTS passava por ele em silêncio.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE NOT i.indisvalid AND c.relname = 'Participation_pending_anonymization_idx'
  ) THEN
    RAISE EXCEPTION 'Índice inválido (CREATE INDEX CONCURRENTLY interrompido): Participation_pending_anonymization_idx. Apagar com DROP INDEX CONCURRENTLY e criar de novo.';
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Participation_pending_anonymization_idx" ON "Participation"("campaignId", "createdAt", "id") WHERE ("anonymizedAt" IS NULL);

RESET lock_timeout;
