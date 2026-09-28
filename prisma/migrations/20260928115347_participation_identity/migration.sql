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

-- Backfill 2: quando a resposta já não se consegue mapear (campo apagado ou
-- renomeado depois da submissão), usa-se o Participant — mas só se ele tiver
-- exatamente UMA participação com formulário. Nesse caso os dados do
-- Participant vieram de certeza dessa submissão; com mais do que uma podiam
-- ser de outra pessoa, e fica em branco em vez de errado.
UPDATE "Participation" AS p
SET
  "email" = COALESCE(p."email", LOWER(NULLIF(BTRIM(pt."email"), ''))),
  "phone" = COALESCE(p."phone", NULLIF(BTRIM(pt."phone"), '')),
  "firstName" = COALESCE(p."firstName", NULLIF(BTRIM(pt."firstName"), '')),
  "lastName" = COALESCE(p."lastName", NULLIF(BTRIM(pt."lastName"), ''))
FROM "Participant" AS pt
WHERE pt."id" = p."participantId"
  AND p."leadFormResponse" IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM "Participation" o
    WHERE o."participantId" = pt."id" AND o."leadFormResponse" IS NOT NULL
  ) = 1;
