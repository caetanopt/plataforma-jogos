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

### Produção: login desligado (desde 9 de outubro de 2026, a pedido)

Com `LOGIN_DISABLED_IN_PRODUCTION = true` (`src/server/auth/bypass.ts`), quem abrir o
backoffice no domínio de produção entra sem password, como o utilizador ativo mais antigo (o
superadmin). Só vale no deploy de produção do Vercel e para pedidos ao domínio de produção
(`VERCEL_PROJECT_PRODUCTION_URL`); os previews, o desenvolvimento local e o URL próprio de cada
deploy continuam a pedir login. Enquanto estiver assim, o backoffice mostra um aviso permanente e
a gestão de utilizadores fica só para consulta.

Para voltar a exigir login:

1. Pôr `false`, publicar no branch de desenvolvimento e no `main`, e confirmar que o domínio de
   produção pede login.
2. No Vercel, nunca fazer Instant Rollback nem Promote para um deploy feito enquanto estava `true`
   (cada deploy congela o valor e voltava a abrir o domínio). O mais seguro é apagá-los em
   *Deployments*.
3. Rever na auditoria o que se fez nesse período: tudo aparece em nome do superadmin.

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

Inclui também a conservação e anonimização dos dados e a exportação dos dados de um titular
(§24, ver abaixo).

Ficam para uma iteração seguinte (não bloqueiam este âmbito): exportação XLSX, importação CSV
em massa de códigos/vouchers, allowlist de domínios de embed,
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

### Design do backoffice (Brand Book Caetano, abril 2026)

- Tokens em `src/app/globals.css`: só os tons oficiais da paleta (04.2), sombras do azul
  profundo (`shadow-xs/sm/md/lg`), a superfície de marca `surface-brand` (azul profundo com a luz
  do azul cyan, como os fundos digitais do manual, 08.9 e 09.4) com a luz decorativa
  `brand-aurora`/`brand-streak`, e o movimento (`animate-enter`, `animate-scale-in`, a cascata
  `stagger`, `skeleton`). Tudo o que se mexe para com `prefers-reduced-motion`.
- Componentes: `PageHeader` (título Bold no azul profundo e uma linha leve, a hierarquia do
  manual), `Card` (com `interactive`), `Button` (com `inverse` sobre a superfície de marca),
  `Select`/`SelectShell`/`controlClass` (campos e seletores com borda a 3:1), `StatCard`,
  `EmptyState` com ícone. As classes dos menus estão em `ui/menu-classes.ts` (sem "use client",
  para os Server Components).
- Barra lateral no azul profundo, com o claim "Your favourite way to move" (07.2). O logótipo
  oficial carregado em Identidade visual aparece lá na versão negativa (branco, 04.3); sem
  ficheiro, só o nome do produto — o wordmark nunca é composto com uma fonte.
- O jogo público continua a usar só as cores do tema de cada campanha (`game-*`), nunca as da
  Caetano; as sombras seguem a opção do tema.
- Verificação: axe (WCAG 2.2 AA) e scroll horizontal em todas as páginas a 1440, 390 e 320 px.

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
  "Sem formulário"); o resto do envio grava-se. Duas edições ao mesmo tempo (dois editores, dois
  separadores) passam uma de cada vez, e a publicação volta a verificar o aviso no momento de
  publicar. As que já estão publicadas sem aviso têm um alerta na etapa Formulário de leads.
- Os campos ocultos não aparecem no jogo: o servidor grava neles o valor predefinido (em «Editar
  campo») e ignora o que o browser mandar. Um campo oculto não pode ser obrigatório, e sem valor
  predefinido o editor avisa que não grava nada.
- A lista de leads mostra o consentimento de marketing e filtra por ele ("com" inclui quem
  aceitou pelo menos um); a exportação respeita o filtro. O CSV tem duas colunas novas no fim
  ("Consentimento de marketing" e "Consentimentos"). Ao exportar uma só campanha, vem também uma
  coluna por consentimento do formulário, na versão atual; uma resposta a outra versão leva-a
  indicada, por exemplo "Recusado (v2)".
- Um consentimento que já tem respostas reais não pode passar a ser (nem deixar de ser) de
  marketing: mudava o que as respostas querem dizer. O texto pode mudar (versão nova). As
  respostas do modo de teste não contam: saem ao mudar o tipo ou ao remover o consentimento.
- Eliminar uma campanha apaga também os participantes que só jogaram nessa campanha, com os
  dados pessoais antigos que tivessem; os que jogaram também noutra ficam, sem esses dados. A
  operação fica na auditoria como operação de privacidade.

### Performance e resiliência

- As estatísticas são agregadas na base de dados, e as contagens de cada tabela numa só query.
- A exportação de leads sai em streaming, por lotes de 500, com um BOM UTF-8 para o Excel ler os
  acentos. Cada exportação deixa dois registos na auditoria: um antes do primeiro byte ("started")
  e outro no fim, com o número de linhas ("completed") ou a interrupção ("interrupted": erro ou
  download cancelado).
- O Redis (rate limit e locks) falha aberto e depressa: cada comando espera no máximo 1 s. Um
  lock cujo pedido excedeu esse tempo é libertado assim que o pedido chega ao Redis.
- O pool de ligações à base de dados tem 10 ligações (`DATABASE_POOL_MAX`), e um pedido espera
  no máximo 10 s por uma livre (`DATABASE_CONNECTION_TIMEOUT_MS`); antes esperava sem fim. As
  transações esperam sempre mais 5 s do que o pool: se desistissem primeiro, a ligação chegava
  depois com uma transação aberta e as escritas seguintes nela perdiam-se.
- Eliminar uma campanha grande (centenas de milhares de participações) tem até 2 minutos, e
  repete sozinho se a base de dados a abortar por deadlock (com um jogo a decorrer).
- O clique em "Jogar" conta-se no servidor, com o limite dos eventos (600 por hora e por IP), e
  não trava o jogo se não se gravar.
- Um quiz submetido com a mesma pergunta ou a mesma resposta repetidas é recusado: a pontuação e
  as estatísticas liam-nas de maneira diferente. O jogo nunca as manda.

### Conservação e anonimização dos dados

- **Prazo de conservação** (§24): em Configurações > Privacidade, o prazo por omissão da
  organização (30, 90, 180 ou 365 dias, ou nenhum). Cada campanha pode ter o seu, na etapa
  Formulário de leads: outro prazo em dias, ou uma data a partir da qual todas as participações
  são anonimizadas. Só os administradores mudam prazos e anonimizam (`privacy:manage`); os
  editores veem o prazo.
- Os dias contam-se a partir de cada participação: com 90 dias, as leads vão sendo anonimizadas à
  medida que chegam aos 90 dias, não todas no fim da campanha. Uma participação com menos de um
  dia nunca é anonimizada automaticamente (pode estar a meio do jogo).
- **Um prazo novo ou alterado só começa a anonimizar 7 dias depois da alteração**, e os avisos
  aparecem logo: escolher "30 dias" numa organização com leads de um ano dá uma semana para as
  exportar. Uma data de anonimização tem de ser pelo menos 7 dias depois de hoje. O editor e as
  Configurações mostram o prazo em vigor e, nesses 7 dias, quando começa.
- **Anonimizar** retira o nome, o e-mail, o telefone, as respostas ao formulário, o IP, a sessão,
  a ligação ao browser (cookie), `utm_content` e `utm_term`, e o caminho e a query da origem (fica
  só o site, por exemplo `news.example`). Ficam o resultado, o prémio e o código, os
  consentimentos (sem ninguém a quem se liguem), a origem e o dispositivo: as estatísticas não
  mudam. O participante que fica sem participações é apagado; o que continua (o mesmo browser
  jogou noutras) perde os dados pessoais antigos que ainda tivesse. É irreversível.
- A origem das participações novas já só guarda o site de onde o visitante veio, não o URL.
- Uma participação anonimizada deixa de contar para os limites de participação: quem jogou numa
  campanha "uma vez no total" pode voltar a jogar depois de os seus dados saírem. Um separador
  ainda aberto numa participação anonimizada não a retoma nem volta a gravar dados.
- **Aviso antes**: a lista de leads e a etapa Formulário de leads avisam das leads que vão ser
  anonimizadas nos 7 dias seguintes (sem as de teste), para as exportar antes.
- **Anonimização manual**, na lista de leads (confirmação com o foco em Cancelar):
  - as selecionadas (o botão diz quantas);
  - todas as dos filtros aplicados, tal como estavam quando a página abriu: se a contagem mudou
    entretanto (leads novas, "Hoje" à meia-noite), recusa e pede para rever. Não se usa com uma
    pesquisa ativa, que procura partes do texto e apanharia outras pessoas;
  - **pedido de um titular**: o e-mail ou o telefone exatos, em todas as campanhas e períodos. O
    telefone encontra-se escrito de qualquer forma: um número português com ou sem o indicativo
    ("912345678", "912 345 678", "+351 912 345 678" e "00351912345678" são o mesmo); os de
    outros países comparam-se pelos dígitos e o "+". As participações do titular são as que têm o
    e-mail ou o telefone nos dados de identificação, e são anonimizadas por inteiro. Uma lead de
    outra pessoa com o identificador numa resposta (o e-mail de um amigo, um segundo telefone) é
    uma **menção**: dessa só sai o campo, e o resto da lead fica. Os campos ocultos não contam (é
    o servidor que os preenche). Saem também os dados antigos dos participantes com o
    identificador. «Procurar» diz quantas participações e quantas menções encontra, sem apagar
    nada; a auditoria guarda as duas contagens.
- **Exportação dos dados de um titular** (pedido de acesso, RGPD art. 15.º, e portabilidade, art.
  20.º): no mesmo pedido de um titular, «Exportar os dados do titular» descarrega um ficheiro JSON
  com tudo o que a organização guarda sobre esse e-mail ou telefone, com as chaves por esta ordem:
  - "Sobre esta exportação" e "Os seus direitos" (acesso, retificação, apagamento, limitação,
    oposição, portabilidade e retirar o consentimento; como os exercer, pelo contacto de
    privacidade da organização; e a reclamação à CNPD, www.cnpd.pt);
  - "Campanhas": o nome público (nunca o interno) e o endereço da página pública, o aviso de
    privacidade que o titular viu (o texto legal do ecrã inicial), os links legais e o prazo de
    conservação;
  - "Participações": as mesmas que a anonimização do titular apanha (todas as campanhas e
    períodos, também as de teste), cada uma com a identificação, as respostas ao formulário com o
    nome de cada campo, os consentimentos (texto, versão, resposta, data e origem), o resultado
    (no quiz, cada pergunta com as respostas escolhidas), o prémio e o código atribuído, a origem e
    as UTM, o dispositivo, o IP e a sessão, os eventos de navegação dessa sessão ("Eventos": o
    tipo e a data, e o motivo de uma recusa; no máximo 200 por participação) e quando vai ser
    anonimizada;
  - "Menções noutras participações": de cada lead de outra pessoa com o identificador numa
    resposta, só a campanha, a data, o campo e o valor — nunca a identidade, as outras respostas,
    o IP, a sessão ou o prémio dessa pessoa;
  - "Dados antigos de participante": só o identificador que coincidiu e a data (o mesmo registo
    antigo de um quiosque pode juntar várias pessoas).

  As chaves estão em português, para o titular ler o ficheiro. Não saem o token da participação
  nem o cookie do browser (são chaves de acesso ao jogo), nem as estatísticas agregadas. Os
  eventos de navegação não têm nome, e-mail nem IP, mas guardam a sessão da participação: por
  isso saem com ela. Só administradores (`privacy:manage`). O identificador vai no corpo de um
  POST (`/api/privacy/subject-export`), nunca no URL, e só da própria página (Origin e JSON); a
  resposta diz nos cabeçalhos `X-Subject-Participations`, `X-Subject-Mentions` e
  `X-Subject-Legacy` quantas encontrou ao procurar (o backoffice conta pelo ficheiro). A auditoria
  regista a exportação ao começar e no fim, só com contagens e o tipo de identificador.
- A lista pode ocultar as anonimizadas, e o CSV tem uma coluna nova, "Anonimizada em", sempre a
  última (depois das colunas por consentimento de uma exportação de campanha).
- Tudo fica na auditoria como operação de privacidade, só com contagens (nunca o e-mail, o
  telefone ou o texto pesquisado): cada anonimização manual tem um registo ao começar e outro no
  fim, também quando falha a meio (com o que já saiu). Cada execução da tarefa diária fica num
  registo global.
- **Tarefa diária**: `vercel.json` agenda `GET /api/cron/retention` para as 03:17 UTC. A rota só
  aceita o cabeçalho `Authorization: Bearer $CRON_SECRET`; sem `CRON_SECRET` definido recusa
  sempre. Anonimiza por lotes de 500, no máximo 30 s por campanha (para uma campanha grande não
  atrasar as outras) e 4 minutos no total; o resto fica para o dia seguinte. Para correr à mão,
  com o `DATABASE_URL` da base de dados: `npm run privacy:retention`.
- Configurações > Privacidade avisa se a tarefa deixou de correr (leads que passaram o prazo há
  mais de dois dias sem execução nesse tempo) ou se corre mas ainda não chegou a todas.

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

O tempo máximo de cada instrução SQL, e de uma transação aberta sem atividade, define-se na base
de dados, não na aplicação: mandado pela aplicação ao abrir a ligação, o pooler da Neon (URL com
`-pooler`, PgBouncer) recusa a ligação. Uma vez, com o papel que a aplicação usa:

```sql
ALTER ROLE <papel_da_aplicacao> SET statement_timeout = '60s';
ALTER ROLE <papel_da_aplicacao> SET idle_in_transaction_session_timeout = '30s';
```

O Prisma aplica cada migração instrução a instrução (não numa transação): se uma falhar, as
anteriores ficam. As migrações destes passos são idempotentes e podem correr outra vez.

A migração `20260930165124_performance_indexes` cria índices em Participation, AuditLog,
ConsentRecord, PrizeAward e PrizeCode. Cada um bloqueia as escritas na sua tabela enquanto é
criado (as leituras continuam). Com tabelas grandes, criar antes os de Participation sem
bloquear: uma instrução de cada vez (não todas num só pedido), numa sessão sem limite de tempo, e
confirmar no fim que nenhum ficou inválido. A migração passa depois por eles.

```sql
SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_campaignId_createdAt_id_idx" ON "Participation"("campaignId", "createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_createdAt_id_idx" ON "Participation"("createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_participantId_idx" ON "Participation"("participantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_campaignVersionId_idx" ON "Participation"("campaignVersionId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_campaignId_ipAddress_idx" ON "Participation"("campaignId", "ipAddress");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_campaignId_sessionId_idx" ON "Participation"("campaignId", "sessionId");
-- O das participações por anonimizar (20261001090000_pending_anonymization_index) precisa da
-- coluna da migração 20260930213627_data_retention, que é idempotente: criá-la antes não a
-- estraga. Sem valor por omissão, o ADD COLUMN é instantâneo depois de obter o bloqueio, mas
-- espera por ele atrás de qualquer transação que esteja a usar a tabela, e todas as queries a
-- "Participation" ficam em fila atrás dele. Com o lock_timeout desiste ao fim de 5 s ("canceling
-- statement due to lock timeout"): nesse caso, voltar a correr estas três linhas.
SET lock_timeout = '5s';
ALTER TABLE "Participation" ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3);
RESET lock_timeout;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Participation_pending_anonymization_idx" ON "Participation"("campaignId", "createdAt", "id") WHERE ("anonymizedAt" IS NULL);

-- Tem de vir vazio. Um índice interrompido fica inválido: apagá-lo
-- (DROP INDEX CONCURRENTLY "<nome>";) e voltar a criá-lo.
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

Se um índice inválido escapar, a migração falha com o nome dele em vez de passar por ele.

As migrações `20260930165124_performance_indexes`, `20260930180000_drop_duplicate_unique_indexes`
e `20261001090000_pending_anonymization_index` desistem se não conseguirem um bloqueio em 5 s (uma transação longa a usar a tabela), em vez de
porem as outras queries em fila. Se o deploy falhar numa migração (o erro do Prisma diz qual),
marcá-la como revertida e voltar a correr o workflow:

```bash
npx prisma migrate resolve --rolled-back <nome_da_migração_que_falhou>
```

Para os prazos de conservação serem aplicados, definir `CRON_SECRET` nas variáveis de ambiente de
produção do Vercel (um valor aleatório longo, `openssl rand -base64 32`). O Vercel lê o
`vercel.json` e agenda a tarefa sozinho no deploy de produção. Sem prazo definido (o valor por
omissão), a tarefa corre e não anonimiza nada.

### Depois do deploy

Por esta ordem, depois de o código novo estar a servir em todas as instâncias (nenhuma do deploy
anterior ainda a responder), com o `DATABASE_URL` de produção:

1. **Telefones.** A migração `20260929230000_normalize_participation_phone` normaliza os
   telefones já gravados. As participações criadas pelo código antigo entre a migração e o
   arranque do código novo ficam por normalizar. A migração é idempotente, por isso volte a
   corrê-la:

   ```bash
   npx prisma db execute --file prisma/migrations/20260929230000_normalize_participation_phone/migration.sql
   ```

2. **Identidade das leads da janela do deploy.** Entre a migração
   `20260928115347_participation_identity` e o arranque do código novo, o código antigo continuou
   a gravar o nome, o e-mail e o telefone só no participante e nas respostas ao formulário: essas
   leads aparecem sem identidade na lista, e a limpeza do passo 3 apagava a única cópia fora da
   resposta. Este SQL repete a cópia da migração a partir das respostas (as mesmas regras: o
   primeiro campo de cada tipo pela ordem do formulário, o e-mail em minúsculas e sem espaços, o
   telefone normalizado como no código), só nas participações sem nenhum dos quatro dados e não
   anonimizadas. É idempotente: pode correr outra vez, e não mexe nas que já têm identidade.

   ```bash
   npx prisma db execute --file prisma/maintenance/backfill_participation_identity.sql
   ```

   Desiste se não conseguir uma dessas participações em 5 s (um jogo a gravá-la), em vez de pôr
   as outras gravações em fila: nesse caso ("canceling statement due to lock timeout"), voltar a
   correr.

3. **Dados pessoais antigos dos participantes.** O nome, o e-mail e o telefone de antes da
   migração da identidade (que os copiou para cada participação) já não são escritos nem lidos,
   mas continuam na base de dados. Depois de confirmar na lista de leads de produção que as leads
   antigas mostram a identidade certa, apagá-los (irreversível; imprime só contagens e ids de
   participação, nunca dados pessoais):

   ```bash
   npm run privacy:clear-legacy                    # simulação: quantos e de que organizações
   npm run privacy:clear-legacy -- --apply         # apaga; fica na auditoria de cada organização
   ```

   A simulação conta, no total e por organização:

   - `participantsWithData`: os participantes que ainda têm nome, e-mail ou telefone (os que a
     limpeza apaga).
   - `leadsOnlyOnParticipant`: leads reais (não de teste, não anonimizadas) a quem falta na
     participação um dado que o participante tem e que o formulário da campanha pede (e-mail,
     telefone, nome ou apelido), e que são a única lead desse participante — as que a migração
     teria completado a partir do participante, e que perdiam esse dado com a limpeza. Depois do
     passo 2 deve ser 0; `participationIds` lista até 20 por organização, para as rever.
   - `ambiguousLeads` e `ambiguousParticipants`: o mesmo, mas de participantes com mais do que uma
     lead (um quiosque, um browser partilhado, também com participações de teste). A migração
     deixou-as em branco de propósito: os dados do participante são os da última submissão e
     podiam ser de outra pessoa. A limpeza apaga-os sem recusar.

   Não contam os formulários sem campos de identidade (só empresa, por exemplo), os tipos que o
   formulário não pede nem as participações de teste.

   A limpeza recusa enquanto as migrações da identidade e da conservação
   (`20260930213627_data_retention`) não tiverem corrido — antes delas nem conta, porque as
   colunas ainda não existem — e enquanto `leadsOnlyOnParticipant` não for 0. Para as perder na
   mesma, `--apply --accept-loss` (a auditoria de cada organização diz se aceitou perder alguma,
   `acceptedLoss`). Com `--organization <id>`, só uma organização.

   Na auditoria de cada organização fica uma linha antes do primeiro lote (`stage: "started"`,
   com as contagens da simulação) e outra no fim: `completed`, ou `interrupted` se falhar a meio,
   com quantos participantes já tinham saído (cada lote de 1000 confirma à parte, e o que saiu não
   volta). Numa falha, o terminal também imprime essas contagens; correr outra vez continua onde
   ficou.

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
