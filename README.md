# Plataforma de Jogos Interativos e Angariação de Leads

Plataforma SaaS para criação, personalização, publicação e gestão de jogos interativos
(Jogo da Memória, Roda da Sorte, Quiz Interativo) orientados a campanhas de marketing e
angariação de leads. Ver [`CLAUDE.md`](./CLAUDE.md) para a especificação funcional completa.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript estrito
- PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`)
- Tailwind CSS 4 (tema de marca Caetano)
- Auth.js (NextAuth v5) — credenciais + verificação de e-mail + recuperação de password
- Redis (locks/idempotência da Roda da Sorte, rate limiting)
- Storage compatível com S3 (MinIO em desenvolvimento)
- Vitest (unitários) + Playwright (e2e)

## Arranque local

```bash
cp .env.example .env          # ajustar se necessário; valores por defeito casam com o docker-compose
docker compose up -d          # Postgres, Redis, MinIO
npm install                   # gera o Prisma Client automaticamente (postinstall)
npm run db:migrate            # aplica as migrações
npm run db:seed               # cria a organização Caetano + utilizador superadmin
npm run dev                   # http://localhost:3000
```

Credenciais do superadmin semeado: num terminal local, o `npm run db:seed` gera a password e
mostra-a uma única vez. Em CI, ou com o output redirecionado, nunca a escreve: exige
`SEED_SUPERADMIN_PASSWORD` para criar o superadmin (ver `.env.example`).

### Produção: migrações, seed e password do superadmin

O workflow manual **BD - Migrações + Seed** (`.github/workflows/db-migrate-seed.yml`) aplica as
migrações e, opcionalmente, corre o seed contra o secret `DATABASE_URL`. A password do
superadmin vem do secret `SEED_SUPERADMIN_PASSWORD` e nunca aparece no log.

Para substituir a password do superadmin em produção (por exemplo, se tiver sido exposta):

1. Em *Settings → Secrets and variables → Actions*, criar ou atualizar o secret
   `SEED_SUPERADMIN_PASSWORD` com a nova password (mínimo 10 caracteres).
2. Correr o workflow com "Também correr o seed" e "Substituir a password do superadmin"
   ativos, no branch que contém esta versão do workflow.

A reposição invalida os links de recuperação pendentes e fica registada na auditoria. As
sessões já abertas continuam válidas até expirarem (8 horas).

Sem Docker, o storage pode ser substituído pelo mock s3rver, na mesma porta:

```bash
npm run dev:storage           # s3rver em http://localhost:9000
```

Nesse caso, trocar `STORAGE_ACCESS_KEY_ID` e `STORAGE_SECRET_ACCESS_KEY` no
`.env` por `S3RVER` — é a única conta que o s3rver aceita. Publicar uma
campanha carrega os QR codes para o storage: sem ele a publicar corretamente,
a publicação falha e os testes end-to-end falham com ela.

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run test          # testes unitários (Vitest)
npm run test:e2e       # testes end-to-end (Playwright)
npm run build          # build de produção
npm run db:studio      # Prisma Studio
```

A suite e2e usa uma conta própria (`E2E_ADMIN_EMAIL`, por omissão `e2e-admin@example.test`)
e recusa correr se `DATABASE_URL` ou `REDIS_URL` não apontarem para `localhost` — escreve
dados e repõe a password dessa conta. Para uma máquina de testes dedicada, definir
`E2E_ALLOW_REMOTE_SERVICES=true` de propósito.

## Dependências

O build precisa das devDependencies (o CLI do Prisma, que gera o cliente no `postinstall`,
está lá). O `npm audit` ainda aponta vulnerabilidades na cadeia do CLI do Prisma
(`@prisma/config`, `mysql2`): é uma ferramenta de desenvolvimento, não vai no bundle da
aplicação, e não há correção na versão 7 — não aplicar o `npm audit fix --force`, que
propõe descer para o Prisma 6.

## Âmbito desta entrega

Cobre as Fases 1-3 do roadmap definido em `CLAUDE.md` (secção 37): autenticação, organizações,
espaços de trabalho, pastas, editor por etapas, os 3 jogos do MVP, formulário de
leads, publicação (link/QR/embed), leads e estatísticas básicas.

A página inicial do backoffice (`/folders`) é a grelha de pastas: é para lá que o login e a raiz
`/` redirecionam. Não há página de dashboard — os alertas de fim de campanha e de stock, e as
contagens por estado, vivem em Estatísticas (`/analytics`); `/dashboard` redireciona para lá.

Ficam para uma iteração seguinte (não bloqueiam este âmbito): exportação XLSX, importação CSV
em massa de códigos/vouchers, anonimização e retenção agendada, allowlist de domínios de embed,
CAPTCHA, interface multilingue e suite Playwright completa (ficam incluídos apenas os smoke
tests essenciais de cada jogo).

## Comportamentos a conhecer

### Gravação no editor

As etapas com gravação automática validam campo a campo: um campo inválido volta com a mensagem
(no estado da gravação, ligado ao input) e os restantes gravam-se. As ações devolvem
`ActionResult` (`src/lib/forms/action-result.ts`) e correm dentro de `runAction`
(`src/server/actions/run-action.ts`). Nas ações de edição, um campo que o formulário não envia
mantém o valor gravado (`readOptional`); as checkboxes levam uma sentinela (`CheckboxField`)
para "desmarcada" se distinguir de "ausente".

### Prémios da Roda da Sorte

- Um prémio inativo, fora do período (`startAt`/`endAt`) ou no limite diário sai do sorteio: o
  peso do segmento reparte-se pelos restantes. O limite diário conta desde a meia-noite no fuso
  da campanha.
- Com o formulário **depois do jogo** ou **antes de revelar o prémio**, o prémio sorteado fica
  **reservado** durante 30 minutos e só passa a atribuído quando a lead é aceite. Uma lead
  recusada (duplicada, bot) ou um formulário abandonado devolve a unidade e o código ao stock.
  Na posição "Depois do jogo", o código e as instruções só aparecem depois do formulário.
- Estatísticas, alertas e o editor descontam as reservas em curso do stock restante. As leads e
  a exportação só mostram o prémio e o código quando atribuídos; o CSV tem uma coluna nova no
  fim, "Estado do prémio".

### Participação no jogo público

- A participação fica no separador (sessionStorage): recarregar a página retoma-a em vez de
  criar outra. Uma participação terminada há mais de 2 horas já não é retomada ("Jogar
  novamente" começa sempre uma nova).
- A memória e o quiz usam também o relógio do servidor (desde que o jogo abre), com uma margem
  de 10 s: recarregar a meio não repõe o tempo.
- A posição do formulário fica fixada no início de cada participação; mudar a posição só afeta
  as participações novas. Um formulário sem campos nem consentimentos conta como "Sem
  formulário".
- Os telefones gravam-se normalizados (só dígitos, com `+` para o indicativo); a resposta
  original fica em `leadFormResponse`.
- O cookie de visitante chama-se `pj_vid`. Em HTTPS é `SameSite=None; Secure; Partitioned`
  para funcionar dentro de um iframe noutro domínio; em HTTP numa rede local (por exemplo, a
  testar num telemóvel) fica `Lax`.

### Marca, textos legais e consentimentos

- O jogo público e a pré-visualização aplicam o tema da campanha (Marca e design): cores,
  tipografia, border radius, sombras, imagem de fundo, logótipo e favicon. Sem tema, fica o
  aspeto Caetano de sempre.
- O texto tem de se ler (WCAG 2.2 AA, 4,5:1; contornos de campos 3:1). Quando uma combinação
  da marca não chega lá, a página usa outra cor de texto e o editor avisa, par a par. Num tema
  escuro, os controlos nativos (calendário, listas) também saem escuros.
- Os temas nasciam com botões azul cyan e texto branco (2,4:1). A migração
  `20260930170137_default_theme_button_contrast` passa os temas e brand kits que ainda têm esse
  par a azul profundo com texto branco — o aspeto que o jogo público sempre mostrou — e muda o
  valor por omissão. Um tema com outra combinação não é tocado.
- O texto legal do ecrã inicial aparece no ecrã inicial e junto ao formulário de leads. Os links
  legais (política de privacidade, termos, cookies) configuram-se no tema, e o contacto de
  privacidade em Configurações > Privacidade (só administradores). Todos aparecem também no
  rodapé do jogo, com o regulamento.
- Uma campanha cujo formulário pede dados pessoais (campos visíveis ou consentimentos) só se
  publica (ou republica) com texto legal ou com o link da política de privacidade. Numa campanha
  já publicada, o editor recusa a edição que tiraria o único aviso (apagar o texto legal, tirar
  o link, aplicar um brand kit sem ele, acrescentar o primeiro campo ou consentimento, sair de
  "Sem formulário"); o resto do envio grava-se. As que já estão publicadas sem aviso têm um
  alerta na etapa Formulário de leads.
- Os campos ocultos não aparecem no jogo: o servidor grava neles o valor predefinido e ignora o
  que o browser mandar.
- A lista de leads mostra o consentimento de marketing e filtra por ele ("com" inclui quem
  aceitou pelo menos um); a exportação respeita o filtro. O CSV tem duas colunas novas no fim
  ("Consentimento de marketing" e "Consentimentos"). Ao exportar uma só campanha, vem também uma
  coluna por consentimento do formulário, na versão atual; uma resposta a outra versão leva-a
  indicada, por exemplo "Recusado (v2)".
- Um consentimento que já tem respostas não pode passar a ser (nem deixar de ser) de marketing:
  mudava o que as respostas querem dizer. O texto pode mudar (versão nova).
- Eliminar uma campanha apaga também os participantes que só jogaram nessa campanha, com os
  dados pessoais antigos que tivessem. A operação fica na auditoria como operação de
  privacidade.

### Antes de fazer deploy destas alterações

Uma campanha publicada com idade mínima passa a recusar todas as participações quando a idade não
se pode verificar: o formulário não tem campo de data de nascimento ou está em "Sem formulário".
Antes, com o formulário em "Sem formulário", a idade nunca era pedida e a campanha deixava jogar
qualquer pessoa. Nas outras posições sem data de nascimento, a lead já era recusada. Depois do
deploy, o editor não deixa criar este estado numa campanha publicada, e a etapa Regras avisa as
que já estão assim. Para as encontrar antes:

```sql
SELECT c.id, c."internalName", c.status
FROM "Campaign" c
LEFT JOIN "LeadForm" lf ON lf."campaignId" = c.id
WHERE c."minAge" IS NOT NULL
  AND c.status IN ('PUBLISHED', 'SCHEDULED', 'PAUSED')
  AND (
    lf.id IS NULL
    OR lf.position = 'NONE'
    OR NOT EXISTS (
      SELECT 1 FROM "LeadFormField" f WHERE f."leadFormId" = lf.id AND f.type = 'BIRTH_DATE'
    )
  );
```

(Um formulário sem campos nem consentimentos também conta como "Sem formulário"; não tem data de
nascimento, por isso a última condição já o apanha.)

As campanhas no ar continuam a funcionar sem texto legal, mas deixam de se poder republicar até
o terem. Para as encontrar (formulário com campos visíveis ou consentimentos, sem texto legal
nem política de privacidade no tema):

```sql
SELECT c.id, c."internalName", c.status
FROM "Campaign" c
JOIN "LeadForm" lf ON lf."campaignId" = c.id
LEFT JOIN "CampaignTheme" t ON t.id = c."themeId"
WHERE c.status IN ('PUBLISHED', 'SCHEDULED', 'PAUSED')
  AND lf.position <> 'NONE'
  AND (
    EXISTS (SELECT 1 FROM "LeadFormField" f WHERE f."leadFormId" = lf.id AND f.type <> 'HIDDEN')
    OR EXISTS (SELECT 1 FROM "ConsentDefinition" d WHERE d."leadFormId" = lf.id)
  )
  AND COALESCE(btrim(c."legalText"), '') = ''
  AND COALESCE(t."legalLinks"->>'privacyPolicyUrl', '') !~ '^https?://';
```

### Depois do deploy

A migração `20260929230000_normalize_participation_phone` normaliza os telefones já gravados. As
participações criadas pelo código antigo entre a migração e o arranque do código novo ficam por
normalizar. A migração é idempotente, por isso volte a corrê-la depois do arranque:

```bash
npx prisma db execute --file prisma/migrations/20260929230000_normalize_participation_phone/migration.sql
```

## Estrutura

```text
src/app/(auth)          páginas de autenticação
src/app/(backoffice)    pastas (início), aplicações, leads, estatísticas, configurações
src/app/play/[slug]     aplicação pública do jogo
src/components          componentes de UI, backoffice, jogo público, gráficos e formulários
src/features            lógica de domínio por área (campaigns, memory-game, wheel-game, ...)
src/server              acesso a BD, auth, permissões, storage, auditoria, jobs
src/lib                 validação, segurança, aleatoriedade, datas, i18n
tests/                  testes unitários e end-to-end
```
