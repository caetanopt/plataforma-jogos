-- Tema por omissão com botões legíveis (WCAG 2.2 AA, §27).
--
-- Os temas nasciam com botões azul cyan (#00AEEF) e texto branco: 2,4:1,
-- abaixo dos 4,5:1. Até ao passo 6 o tema não era aplicado ao jogo público,
-- que mostrava sempre botões azul profundo com texto branco; com o tema
-- aplicado, quase todas as campanhas mudavam de aspeto (e a página trocava o
-- texto branco por antracite para se ler).
--
-- Os temas e brand kits que ainda têm esse par por omissão passam a azul
-- profundo (#002E5D) com texto branco (13:1): o aspeto que o público já via.
-- Um tema com outra combinação escolhida não é tocado.

-- AlterTable
ALTER TABLE "CampaignTheme" ALTER COLUMN "buttonColor" SET DEFAULT '#002E5D';

-- Dados: só o par por omissão (maiúsculas ou minúsculas, o seletor de cor
-- grava em minúsculas).
UPDATE "CampaignTheme"
SET "buttonColor" = '#002E5D'
WHERE upper("buttonColor") = '#00AEEF' AND upper("buttonTextColor") = '#FFFFFF';
