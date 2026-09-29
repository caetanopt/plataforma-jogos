-- Normaliza os telefones já gravados nas participações com a mesma regra de
-- normalizePhone (src/features/play/identity.ts): só dígitos, com "+" quando
-- o primeiro carácter relevante é "+" ou o número começa por "00". Sem isto,
-- "912 345 678" gravado antes e "912345678" gravado depois não coincidiam no
-- controlo de duplicados por telefone.
--
-- Só dados; idempotente (um valor já normalizado fica igual). A resposta
-- original continua em "leadFormResponse".
WITH src AS (
  SELECT id, "phone" AS raw, regexp_replace("phone", '[^0-9]', '', 'g') AS digits
  FROM "Participation"
  WHERE "phone" IS NOT NULL
), norm AS (
  SELECT id,
    CASE
      WHEN digits = '' THEN NULL
      WHEN substring(raw from '[0-9+]') = '+' THEN '+' || digits
      WHEN digits ~ '^00.' THEN '+' || substr(digits, 3)
      ELSE digits
    END AS phone
  FROM src
)
UPDATE "Participation" p
SET "phone" = norm.phone
FROM norm
WHERE norm.id = p.id AND p."phone" IS DISTINCT FROM norm.phone;
