-- Retira os índices repetidos de User.email e Organization.slug: os @unique
-- já criam um índice único nas mesmas colunas.
--
-- O DROP INDEX bloqueia a tabela, também para leituras (login, contexto da
-- organização, página pública), mas é instantâneo. Fica numa migração só
-- sua para o bloqueio durar apenas isso; e, se não o conseguir em 5 s, falha
-- em vez de pôr as queries seguintes em fila atrás dele.
SET lock_timeout = '5s';

-- DropIndex
DROP INDEX IF EXISTS "Organization_slug_idx";

-- DropIndex
DROP INDEX IF EXISTS "User_email_idx";
