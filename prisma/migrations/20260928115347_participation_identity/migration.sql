-- A identidade da lead passa a viver em cada participação.
--
-- Até aqui vivia no Participant, que é partilhado por todos os que usam o
-- mesmo browser: cada submissão reescrevia o nome, o e-mail e o telefone, e
-- as leads anteriores desse browser passavam a mostrar a última pessoa.

-- AlterTable
ALTER TABLE "Participation" ADD COLUMN     "email" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Participation_campaignId_email_idx" ON "Participation"("campaignId", "email");

-- CreateIndex
CREATE INDEX "Participation_campaignId_phone_idx" ON "Participation"("campaignId", "phone");

-- Backfill 1: a partir da resposta gravada em cada participação
-- (leadFormResponse, chaveada pelo internalKey de cada campo), que nunca foi
-- reescrita. Por tipo de campo usa-se o primeiro pela ordem do formulário,
-- como faz o código. O e-mail fica normalizado (minúsculas, sem espaços).
UPDATE "Participation" AS p
SET
  "email" = LOWER(NULLIF(BTRIM(p."leadFormResponse" ->> (
    SELECT f."internalKey"
    FROM "LeadFormField" f
    JOIN "LeadForm" lf ON lf."id" = f."leadFormId"
    WHERE lf."campaignId" = p."campaignId" AND f."type" = 'EMAIL'
    ORDER BY f."order", f."id"
    LIMIT 1
  )), '')),
  "phone" = NULLIF(BTRIM(p."leadFormResponse" ->> (
    SELECT f."internalKey"
    FROM "LeadFormField" f
    JOIN "LeadForm" lf ON lf."id" = f."leadFormId"
    WHERE lf."campaignId" = p."campaignId" AND f."type" = 'PHONE'
    ORDER BY f."order", f."id"
    LIMIT 1
  )), ''),
  "firstName" = NULLIF(BTRIM(p."leadFormResponse" ->> (
    SELECT f."internalKey"
    FROM "LeadFormField" f
    JOIN "LeadForm" lf ON lf."id" = f."leadFormId"
    WHERE lf."campaignId" = p."campaignId" AND f."type" IN ('FIRST_NAME', 'FULL_NAME')
    ORDER BY f."order", f."id"
    LIMIT 1
  )), ''),
  "lastName" = NULLIF(BTRIM(p."leadFormResponse" ->> (
    SELECT f."internalKey"
    FROM "LeadFormField" f
    JOIN "LeadForm" lf ON lf."id" = f."leadFormId"
    WHERE lf."campaignId" = p."campaignId" AND f."type" = 'LAST_NAME'
    ORDER BY f."order", f."id"
    LIMIT 1
  )), '')
WHERE p."leadFormResponse" IS NOT NULL
  AND jsonb_typeof(p."leadFormResponse") = 'object';

-- Backfill 2: quando a resposta já não se consegue mapear (campo renomeado
-- ou recriado depois da submissão), usa-se o Participant — mas só se ele
-- tiver exatamente UMA participação com formulário (os dados vieram dessa
-- submissão; com mais do que uma podiam ser de outra pessoa) e só para os
-- tipos de campo que o formulário da campanha tem (o Participant é da
-- organização inteira e podia trazer um e-mail de outra campanha, já
-- apagada). Na dúvida fica em branco em vez de errado.
--
-- As contagens são agregadas uma vez (CTE) em vez de uma subconsulta por
-- linha, que tornava isto quadrático no número de participações.
WITH "singleLead" AS (
  SELECT "participantId"
  FROM "Participation"
  WHERE "leadFormResponse" IS NOT NULL AND "participantId" IS NOT NULL
  GROUP BY "participantId"
  HAVING COUNT(*) = 1
),
"formTypes" AS (
  SELECT
    lf."campaignId",
    BOOL_OR(f."type" = 'EMAIL') AS "hasEmail",
    BOOL_OR(f."type" = 'PHONE') AS "hasPhone",
    BOOL_OR(f."type" IN ('FIRST_NAME', 'FULL_NAME')) AS "hasFirstName",
    BOOL_OR(f."type" = 'LAST_NAME') AS "hasLastName"
  FROM "LeadForm" lf
  JOIN "LeadFormField" f ON f."leadFormId" = lf."id"
  GROUP BY lf."campaignId"
)
UPDATE "Participation" AS p
SET
  "email" = COALESCE(p."email", CASE WHEN ft."hasEmail" THEN LOWER(NULLIF(BTRIM(pt."email"), '')) END),
  "phone" = COALESCE(p."phone", CASE WHEN ft."hasPhone" THEN NULLIF(BTRIM(pt."phone"), '') END),
  "firstName" = COALESCE(p."firstName", CASE WHEN ft."hasFirstName" THEN NULLIF(BTRIM(pt."firstName"), '') END),
  "lastName" = COALESCE(p."lastName", CASE WHEN ft."hasLastName" THEN NULLIF(BTRIM(pt."lastName"), '') END)
FROM "Participant" AS pt, "singleLead" AS s, "formTypes" AS ft
WHERE pt."id" = p."participantId"
  AND s."participantId" = pt."id"
  AND ft."campaignId" = p."campaignId"
  AND p."leadFormResponse" IS NOT NULL;
