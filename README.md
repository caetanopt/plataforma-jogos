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

Credenciais do superadmin semeado: ver output do `npm run db:seed`.

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
espaços de trabalho, pastas, dashboard, editor por etapas, os 3 jogos do MVP, formulário de
leads, publicação (link/QR/embed), leads e estatísticas básicas.

Ficam para uma iteração seguinte (não bloqueiam este âmbito): exportação XLSX, importação CSV
em massa de códigos/vouchers, anonimização e retenção agendada, allowlist de domínios de embed,
CAPTCHA, interface multilingue e suite Playwright completa (ficam incluídos apenas os smoke
tests essenciais de cada jogo).

## Estrutura

```text
src/app/(auth)          páginas de autenticação
src/app/(backoffice)    dashboard, aplicações, pastas, leads, estatísticas, configurações
src/app/play/[slug]     aplicação pública do jogo
src/components          componentes de UI, backoffice, jogo público, gráficos e formulários
src/features            lógica de domínio por área (campaigns, memory-game, wheel-game, ...)
src/server              acesso a BD, auth, permissões, storage, auditoria, jobs
src/lib                 validação, segurança, aleatoriedade, datas, i18n
tests/                  testes unitários e end-to-end
```
