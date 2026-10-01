-- Texto alternativo do logótipo do tema (§10, §27). Antes o jogo público ia
-- buscar, na altura de cada visita, o nome interno do brand kit de origem
-- (um rótulo do backoffice, que mudava as campanhas já publicadas quando o
-- kit era renomeado). Passa a ser um campo do tema, copiado com o resto.
--
-- Idempotente: o Prisma confirma cada instrução à parte, e uma migração que
-- falhe a meio tem de poder correr outra vez.
--
-- O ALTER TABLE só mexe no catálogo (coluna opcional, sem default), mas
-- espera pelas leituras em curso de "CampaignTheme", lida em cada visita ao
-- jogo: sem limite, as visitas seguintes ficavam em fila atrás dele.
SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "CampaignTheme" ADD COLUMN IF NOT EXISTS "logoAltText" TEXT;

RESET lock_timeout;

-- O texto alternativo que já estivesse gravado no ficheiro do logótipo (o
-- que o jogo usava antes) passa para o tema, para nenhuma campanha o perder.
-- Só a mesma organização, só temas ainda sem texto, e no limite do editor
-- (BRAND_THEME_LIMITS.logoAltText).
UPDATE "CampaignTheme" AS t
SET "logoAltText" = left(btrim(m."altText"), 200)
FROM "MediaAsset" AS m
WHERE m."id" = t."logoMediaId"
  AND m."organizationId" = t."organizationId"
  AND t."logoAltText" IS NULL
  AND btrim(coalesce(m."altText", '')) <> '';
