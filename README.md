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
