-- Repete a cópia da identidade da migração 20260928115347_participation_identity
-- (o backfill 1, a partir das respostas ao formulário) para as leads gravadas
-- na janela do deploy: depois de a migração correr e antes de o código novo
-- arrancar em todas as instâncias, o código antigo continuou a escrever o
-- nome, o e-mail e o telefone só no Participant e na resposta
-- (leadFormResponse). Essas participações ficavam sem identidade: a lista de
-- leads mostrava-as em branco, e a limpeza dos dados antigos
-- (npm run privacy:clear-legacy) apagava a única cópia fora da resposta.
--
--   npx prisma db execute --file prisma/maintenance/backfill_participation_identity.sql
--
-- (Fora de prisma/migrations: não é uma migração, corre-se à mão depois do
-- deploy — README, "Depois do deploy" — e as vezes que for preciso.)
--
-- As mesmas regras da migração e do código (src/features/play/identity.ts):
-- a resposta chaveada pelo internalKey de cada campo; por tipo, o primeiro
-- campo pela ordem do formulário; o e-mail em minúsculas e sem espaços; o
-- telefone como normalizePhone (e a migração
-- 20260929230000_normalize_participation_phone) — só dígitos, com "+" quando
-- o primeiro carácter relevante é "+" ou o número começa por "00". Não usa o
-- Participant (o backfill 2): numa lead da janela do deploy, a resposta é a
-- fonte certa, e o participante pode ter sido reescrito por outra pessoa.
--
-- Só toca nas participações sem nenhuma das quatro colunas preenchida e não
-- anonimizadas: as do código novo (que as preenche ao gravar) e as que a
-- migração já copiou ficam como estão. Idempotente: correr outra vez não
-- muda nada.

-- Desiste se não conseguir uma destas participações em 5 s (um jogo a
-- gravá-la), em vez de as outras gravações ficarem à espera: basta correr
-- outra vez.
SET lock_timeout = '5s';

-- Por campanha, o internalKey do primeiro campo de cada tipo (uma vez, em vez
-- de uma subconsulta por participação).
WITH "keys" AS (
  SELECT
    lf."campaignId",
    (ARRAY_AGG(f."internalKey" ORDER BY f."order", f."id") FILTER (WHERE f."type" = 'EMAIL'))[1] AS "emailKey",
    (ARRAY_AGG(f."internalKey" ORDER BY f."order", f."id") FILTER (WHERE f."type" = 'PHONE'))[1] AS "phoneKey",
    (ARRAY_AGG(f."internalKey" ORDER BY f."order", f."id") FILTER (WHERE f."type" IN ('FIRST_NAME', 'FULL_NAME')))[1] AS "firstNameKey",
    (ARRAY_AGG(f."internalKey" ORDER BY f."order", f."id") FILTER (WHERE f."type" = 'LAST_NAME'))[1] AS "lastNameKey"
  FROM "LeadForm" lf
  JOIN "LeadFormField" f ON f."leadFormId" = lf."id"
  WHERE f."type" IN ('EMAIL', 'PHONE', 'FIRST_NAME', 'FULL_NAME', 'LAST_NAME')
  GROUP BY lf."campaignId"
),
"answers" AS (
  SELECT
    p."id",
    LOWER(NULLIF(BTRIM(p."leadFormResponse" ->> k."emailKey"), '')) AS "email",
    p."leadFormResponse" ->> k."phoneKey" AS "rawPhone",
    regexp_replace(p."leadFormResponse" ->> k."phoneKey", '[^0-9]', '', 'g') AS "digits",
    NULLIF(BTRIM(p."leadFormResponse" ->> k."firstNameKey"), '') AS "firstName",
    NULLIF(BTRIM(p."leadFormResponse" ->> k."lastNameKey"), '') AS "lastName"
  FROM "Participation" p
  JOIN "keys" k ON k."campaignId" = p."campaignId"
  WHERE p."email" IS NULL AND p."phone" IS NULL AND p."firstName" IS NULL AND p."lastName" IS NULL
    AND p."anonymizedAt" IS NULL
    AND p."leadFormResponse" IS NOT NULL
    AND jsonb_typeof(p."leadFormResponse") = 'object'
),
"identity" AS (
  SELECT
    "id",
    "email",
    CASE
      WHEN "digits" IS NULL OR "digits" = '' THEN NULL
      WHEN substring("rawPhone" from '[0-9+]') = '+' THEN '+' || "digits"
      WHEN "digits" ~ '^00.' THEN '+' || substr("digits", 3)
      ELSE "digits"
    END AS "phone",
    "firstName",
    "lastName"
  FROM "answers"
)
UPDATE "Participation" AS p
SET "email" = i."email", "phone" = i."phone", "firstName" = i."firstName", "lastName" = i."lastName"
FROM "identity" AS i
WHERE p."id" = i."id"
  -- Uma resposta sem nenhum dos quatro (campos opcionais em branco) não é
  -- reescrita: correr outra vez não toca em nada.
  AND (i."email" IS NOT NULL OR i."phone" IS NOT NULL OR i."firstName" IS NOT NULL OR i."lastName" IS NOT NULL)
  -- Outra vez aqui: o Postgres volta a avaliá-las na versão nova de uma linha
  -- gravada ou anonimizada entretanto, que fica como está.
  AND p."email" IS NULL AND p."phone" IS NULL AND p."firstName" IS NULL AND p."lastName" IS NULL
  AND p."anonymizedAt" IS NULL;

RESET lock_timeout;
