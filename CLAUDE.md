# CLAUDE.md — Plataforma de Jogos Interativos e Angariação de Leads

@AGENTS.md

## 1. Visão do produto

Desenvolver uma plataforma web SaaS para criação, personalização, publicação e gestão de jogos interativos orientados para campanhas de marketing e captação de leads.

O produto deve disponibilizar um backoffice no qual utilizadores autorizados possam criar campanhas sem conhecimentos de programação, configurar formulários, personalizar a identidade visual, testar, publicar, acompanhar resultados e exportar leads.

A referência funcional pode ser semelhante a plataformas como a Drimify, mas não devem ser copiados código, textos, assets, identidade visual ou componentes protegidos de terceiros.

## 2. Escopo do MVP

Na primeira fase, suportar apenas:

1. Jogo da Memória.
2. Roda da Sorte.
3. Quiz Interativo.

O MVP deve incluir autenticação, organizações, utilizadores, espaços de trabalho, pastas, criação e gestão de jogos, editor por etapas, identidade visual, formulário de leads, pré-visualização, modo de teste, agendamento, publicação por URL, QR Code, embed, estatísticas, exportação de leads, consentimentos e limites de participação.

Ficam fora do MVP: outros jogos, marketplace, pagamentos, app nativa, API pública, integrações CRM avançadas, webhooks configuráveis, editor visual livre e domínios personalizados.

## 3. Perfis e permissões

### Superadministrador
- Gerir organizações, utilizadores e limites.
- Aceder a todos os projetos.
- Gerir templates globais.
- Consultar auditoria.
- Suspender organizações.
- Executar operações de privacidade.

### Administrador da organização
- Gerir utilizadores e espaços.
- Criar, editar, publicar e arquivar jogos.
- Consultar e exportar leads.
- Consultar estatísticas.
- Gerir identidade visual e permissões.

### Editor
- Criar e editar jogos autorizados.
- Pré-visualizar e testar.
- Publicar apenas com permissão.

### Analista
- Consultar estatísticas, participações e leads.
- Exportar dados quando autorizado.

### Visualizador
- Consultar projetos e relatórios sem editar.

Usar RBAC e validar permissões no servidor. Nunca depender apenas do frontend.

## 4. Estrutura do backoffice

Navegação principal:

- Início (grelha de pastas).
- Aplicações.
- Espaços de trabalho.
- Templates.
- Leads.
- Estatísticas.
- Utilizadores.
- Identidade visual.
- Configurações.
- Ajuda.

Não existe página de dashboard: `/dashboard` redireciona para `/analytics`.

### Página inicial

A página inicial é a grelha de pastas (`/folders`), orientada ao trabalho do dia a dia: saudação,
botão "Criar aplicação", separadores Ativas/Arquivadas, ordenação e um cartão por pasta com o
espaço de trabalho, o número de aplicações e as ações rápidas. É o destino do login e da raiz `/`.

### Onde vive cada coisa

Não há dashboard de métricas. O que existia nele está distribuído:

- Botão "Criar aplicação" e visão geral do trabalho: página inicial.
- Campanhas recentes e campanhas ativas: Aplicações (`/apps`), que já ordena por
  atualização recente e filtra por estado.
- Visualizações, participações, leads, taxa de conversão, contagens por estado,
  alertas de fim e alertas de stock: Estatísticas (secção 20).

## 5. Organização de projetos

### Espaços de trabalho

Agrupam campanhas, utilizadores e permissões por marca, departamento, cliente ou unidade de negócio.

### Pastas

Permitir criar, renomear, arquivar, eliminar e mover aplicações.

### Lista de aplicações

Permitir vista em grelha e lista, pesquisa, filtros por estado, tipo, pasta, autor e data, ordenação e ações rápidas.

Cada aplicação deve mostrar miniatura, nome, tipo, pasta, estado, autor, atualização, publicação, participações e menu de ações.

Ações: editar, pré-visualizar, testar, duplicar, mover, publicar, pausar, arquivar, estatísticas, leads e eliminar.

## 6. Estados da aplicação

- Rascunho.
- Em validação.
- Agendado.
- Publicado.
- Pausado.
- Expirado.
- Arquivado.

Rascunhos não são públicos. Campanhas agendadas só abrem no período definido. Campanhas pausadas não aceitam participações. Campanhas expiradas mostram mensagem própria. Eliminar exige confirmação e aviso sobre os dados associados.

## 7. Editor por etapas

O editor deve usar navegação lateral e gravação automática.

Etapas:

1. Informações do projeto.
2. Ecrã inicial.
3. Marca e design.
4. Formulário de leads.
5. Ecrã intermédio opcional.
6. Configuração do jogo.
7. Resultado e ecrã final.
8. Regras de participação.
9. Agenda.
10. Publicação.

Áreas adicionais: estatísticas, leads, ranking e auditoria.

Requisitos: autosave, validação por etapa, indicação de etapas incompletas, navegação sem perda de dados, ajuda contextual, preview mobile e desktop, simulação de resultados e estados de loading, erro, sucesso e vazio.

## 8. Informações do projeto

Campos: nome interno, título público, referência interna, tipo de jogo, espaço de trabalho, pasta, etiquetas, responsável, descrição, idioma, fuso horário e slug público.

O tipo de jogo não pode ser alterado depois de existirem participações reais. Deve ser possível duplicar o projeto.

## 9. Ecrã inicial

Configurações:

- Título e subtítulo.
- Texto introdutório.
- Imagem ou vídeo.
- Logótipo.
- Botão principal.
- Informação sobre prémio.
- Data de término.
- Contagem decrescente.
- Regulamento.
- Texto legal.

Media: JPG, JPEG, PNG, WebP, GIF e MP4 opcional. SVG apenas sanitizado. Validar MIME, tamanho e conteúdo. Permitir crop, reposicionamento e texto alternativo.

## 10. Marca e design

Permitir configurar logótipo, favicon, cores, tipografia, fundo, imagem de fundo, botões, border radius, sombras, cabeçalho, rodapé e links legais.

### Brand kits

Permitir guardar e reutilizar configurações de marca. Cada campanha recebe uma cópia, evitando alterações retroativas inesperadas.

## 11. Formulário de angariação de leads

### Posição

- Antes do jogo.
- Depois do jogo.
- Antes de revelar o resultado.
- Antes de revelar o prémio.
- Sem formulário.

### Campos

Nome, apelido, nome completo, e-mail, telefone, data de nascimento, código postal, localidade, país, empresa, cargo, número de cliente, escolha única, escolha múltipla, texto curto, texto longo, dropdown, data, checkbox, campo oculto, consentimento e aceitação de regulamento.

Cada campo permite label, placeholder, ajuda, obrigatório, ordem, validação, identificador interno, valor predefinido e mapeamento de exportação.

### Consentimentos

Guardar texto, versão, data, estado, campanha, versão e origem. Consentimentos de marketing nunca podem estar pré-selecionados.

### Controlo de duplicados

Permitir limites por e-mail, telefone, cookie, sessão, IP com uso limitado, código único ou combinação de campos.

## 12. Jogo da Memória

### Conteúdo

Permitir pares de imagens iguais, imagens diferentes associadas, imagem-texto e texto-texto. Incluir upload, reordenação, duplicação, remoção, verso das cartas e texto alternativo.

### Grelha

Número de pares, colunas, ordem aleatória, dimensão, espaçamento, proporção e ajuste automático ao mobile.

### Mecânicas

Tempo limite, máximo de tentativas, pontos por par, penalização por erro, bónus por rapidez, pontuação visível, cronómetro, pré-visualização inicial, sons opcionais e mensagens de conclusão ou falha.

### Dados guardados

Tempo, tentativas, pares encontrados, pontuação, estado, sessão e lead associado.

### Ranking

Opcional no MVP: pontuação, desempate por menor tempo, nome público, anonimização e limite de posições.

## 13. Roda da Sorte

### Segmentos

Cada segmento deve incluir nome, cor, imagem, vencedor ou não vencedor, prémio, peso, quantidade, período, mensagem, código opcional e estado.

### Motor de resultado

Obrigatório:

- Resultado calculado no servidor.
- Aleatoriedade segura.
- Respeito por pesos, stock, limites e datas.
- Transação atómica.
- Idempotência.
- Auditoria.
- Impossibilidade de manipulação pelo browser.
- Probabilidades privadas não expostas.

A área visual dos segmentos não determina a probabilidade.

### Prémios

Nome interno e público, descrição, imagem, quantidade total, atribuída e restante, datas, limite diário, código ou voucher, instruções, termos e estado.

### Fluxo técnico

1. Cliente solicita rotação.
2. Servidor valida campanha e elegibilidade.
3. Servidor determina resultado.
4. Resultado e stock são gravados numa transação.
5. Cliente recebe apenas o resultado final.
6. Repetir o mesmo pedido não atribui outro prémio.
7. Atualizar a página não recalcula o resultado.

## 14. Quiz Interativo

### Tipos de pergunta

- Escolha única.
- Escolha múltipla.
- Verdadeiro ou falso.
- Respostas com imagem.

### Configuração por pergunta

Título, apoio, imagem, respostas, resposta correta, pontos, tempo limite, explicação, ordem, obrigatoriedade e feedback imediato ou final.

### Configuração global

Perguntas por participação, ordem aleatória, respostas aleatórias, tempo total, tempo por pergunta, penalização, bónus por rapidez, voltar atrás, progresso, resposta correta, explicação, aprovação mínima e tentativas.

### Resultados

Resultado por percentagem, aprovado ou não aprovado, mensagem personalizada e perfis por intervalos. Cada perfil pode incluir título, descrição, imagem, CTA e link.

### Dados guardados

Resposta por pergunta, correta ou incorreta, pontos, pontuação total, percentagem, tempo, perfil final, estado e lead associado.

## 15. Ecrãs intermédios e finais

Ecrã intermédio: título, texto, imagem ou vídeo, CTA, link e botão continuar. No MVP, limitar a um antes e um depois do jogo.

Ecrã final: título, mensagem, imagem, resultado, pontuação, tempo, prémio, código, CTA, link, repetir, partilhar, regulamento e contactos.

## 16. Participação e elegibilidade

Configurações: ilimitada, uma total, uma por dia, uma por hora, máximo personalizado, limite por e-mail, telefone, cookie ou código, idade mínima, datas e regulamento.

Antes do jogo, validar estado, agenda, limites, stock, idade, campos e consentimentos.

## 17. Agenda

Campos: início, fim, fuso horário, mensagem antes, mensagem depois e redirecionamento opcional.

Comportamento: publicação e expiração automáticas, tarefas idempotentes, histórico e alertas antes do fim.

## 18. Preview e modo de teste

Preview em desktop, tablet e mobile, retrato e paisagem, com dados fictícios e simulação de resultados.

O modo de teste não conta para estatísticas, não consome stock, não atribui prémios válidos, marca participações como teste e deve ter aviso visual permanente.

## 19. Publicação

### Link direto

URL pública, slug, copiar, estado e datas.

### QR Code

Gerado automaticamente, com download em PNG e SVG e validação de leitura.

### Embed

Iframe responsivo, altura configurável, preview e futura lista de domínios permitidos.

### Partilha

Copiar link, UTM, origem personalizada e redes sociais opcionais.

## 20. Estatísticas

Métricas gerais:

- Visualizações.
- Visualizações únicas aproximadas.
- Inícios.
- Participações.
- Conclusões.
- Leads.
- Taxa de início.
- Taxa de conclusão.
- Conversão em lead.
- Tempo médio.
- Tráfego mobile.
- Origem.
- Dispositivo.
- Browser.
- Sistema operativo.

Memória: pontuação média, tempo, tentativas, conclusão e ranking.

Roda: rotações, vencedores, não vencedores, taxa de vitória, distribuição de prémios, stock e bloqueios.

Quiz: pontuação média, aprovação, respostas por pergunta, acerto, abandono, tempo e perfis.

Estado do portefólio: publicados, rascunhos, agendados e pausados. É o retrato atual, independente do período selecionado.

Alertas: campanhas publicadas que terminam nos 3 dias seguintes e prémios com stock restante igual ou inferior a 5. Os alertas também não dependem do período — respondem ao que exige atenção agora.

Filtros: hoje, 7, 30 e 90 dias, todo o período, intervalo personalizado, campanha, espaço de trabalho, pasta/marca, tipo de jogo, dispositivo, origem, resultado e prémio.

## 21. Leads e participações

Uma linha por participação, com ID, data, estado, nome, e-mail, telefone, consentimentos, jogo, resultado, pontuação, tempo, prémio, código, origem, UTM, dispositivo, teste e sessão.

Funcionalidades: pesquisa, filtros, ordenação, colunas configuráveis, paginação, detalhe, exportação CSV e XLSX, eliminação, anonimização, ações em lote e auditoria de exportação.

A exportação deve respeitar os filtros ativos.

## 22. Códigos e stock

Permitir importar códigos por CSV, gerar códigos, associar a prémios, marcar estados, definir validade e impedir duplicados.

Estados: disponível, reservado, atribuído, utilizado, expirado e cancelado.

Usar transações e locking para impedir atribuições duplicadas.

## 23. Templates

Templates iniciais: Memória simples, Roda promocional e Quiz de conhecimento.

Podem guardar estrutura, design, textos, formulário e regras. Nunca guardar leads, participações, códigos atribuídos ou histórico.

## 24. RGPD

Aplicar privacy by design:

- Minimização de dados.
- Finalidade explícita.
- Consentimentos versionados.
- Retenção configurável.
- Exportação do titular.
- Eliminação ou anonimização.
- Acesso restrito.
- Encriptação em trânsito.
- Dados pessoais fora dos logs.
- Política de privacidade.
- Regulamento.
- Contacto de privacidade.

Retenção sugerida: 30, 90, 180 ou 365 dias, ou data personalizada, com aviso antes da eliminação.

## 25. Segurança

- Hash forte de passwords.
- Sessões seguras.
- Verificação de e-mail.
- Recuperação de password.
- Rate limiting.
- Proteção contra bots.
- CAPTCHA opcional.
- Honeypot.
- Validação server-side.
- Idempotency keys.
- Proteção XSS, CSRF e injection.
- CSP.
- Uploads seguros.
- SVG sanitizado.
- URLs externas validadas.
- Isolamento multi-tenant.
- Auditoria.
- Segredos apenas no servidor.
- Nunca guardar `.env` no repositório.

## 26. Auditoria

Registar login, falhas, criação, edição, publicação, pausa, arquivo, eliminação, exportação, alterações de permissões, probabilidades, stock, códigos e operações de privacidade.

Guardar utilizador, organização, ação, entidade, data, resultado e metadados não sensíveis.

## 27. Acessibilidade

Procurar WCAG 2.2 AA: teclado, focus visível, labels, contraste, leitores de ecrã, texto alternativo, erros associados, áreas clicáveis adequadas, `prefers-reduced-motion` e alternativa à animação da roda.

## 28. Arquitetura recomendada

Stack:

- Next.js com App Router.
- React.
- TypeScript estrito.
- PostgreSQL.
- Prisma ou Drizzle.
- Tailwind CSS.
- React Hook Form.
- Zod.
- Redis para locks, rate limiting e filas.
- Storage compatível com S3.
- Serviço de e-mail.
- Biblioteca de gráficos.
- Vitest ou Jest.
- Playwright.

Separar backoffice, aplicação pública, API, workers, media, motor de jogos, motor de prémios, analytics e exportações.

Princípios: multi-tenant, lógica crítica no servidor, idempotência, transações, processamento assíncrono, migrações versionadas e observabilidade.

## 29. Estrutura sugerida

```text
src/
  app/
    (auth)/
    (backoffice)/
      apps/
      folders/
      leads/
      analytics/
      settings/
    play/[slug]/
    api/
  components/
    ui/
    backoffice/
    public-game/
    charts/
    forms/
  features/
    auth/
    organizations/
    workspaces/
    campaigns/
    lead-forms/
    memory-game/
    wheel-game/
    quiz-game/
    prizes/
    publishing/
    analytics/
    exports/
  server/
    db/
    auth/
    permissions/
    jobs/
    storage/
    audit/
  lib/
    validation/
    security/
    random/
    dates/
    i18n/
  tests/
```

## 30. Entidades principais

User, Organization, Membership, Workspace, Folder, Campaign, CampaignVersion, CampaignTheme, CampaignScreen, LeadForm, LeadFormField, ConsentDefinition, Participant, Participation, ConsentRecord, GameSession, MemoryGameConfig, MemoryCardPair, WheelConfig, WheelSegment, Prize, PrizeCode, PrizeAward, QuizConfig, QuizQuestion, QuizAnswer, QuizResultProfile, QuizResponse, AnalyticsEvent, Publication, MediaAsset e AuditLog.

Uma campanha publicada deve gerar uma versão imutável. Participações ficam ligadas à versão publicada.

## 31. Analytics por eventos

Eventos mínimos:

- `campaign_viewed`
- `start_clicked`
- `lead_form_viewed`
- `lead_form_submitted`
- `game_started`
- `game_completed`
- `game_abandoned`
- `result_viewed`
- `cta_clicked`
- `participation_blocked`
- `prize_awarded`

Não guardar dados pessoais no sistema de analytics.

## 32. Performance

Aplicação pública: mobile first, bundle reduzido, imagens responsivas, lazy loading, CDN, fontes otimizadas, cache e animações eficientes.

Backoffice: paginação e filtros no servidor, virtualização quando necessário, exportações em background e upload direto para storage com URLs assinados.

## 33. Testes

### Unitários

Elegibilidade, limites, pontuação, pares, distribuição da roda, stock, idempotência, quiz, consentimentos, datas e fusos horários.

### Integração

Criação, publicação, participação, lead, prémio, exportação, versionamento, permissões e multi-tenancy.

### End-to-end

1. Criar e publicar Memória.
2. Participar e guardar lead.
3. Exportar dados.
4. Criar Roda.
5. Atribuir prémio e reduzir stock.
6. Repetir pedido e confirmar idempotência.
7. Criar Quiz.
8. Responder e calcular pontuação.
9. Testar mobile.
10. Testar teclado.
11. Confirmar que o modo de teste não afeta dados reais.

### Segurança

IDOR, XSS, CSRF, rate limiting, upload malicioso, manipulação de resultado, concorrência e acesso entre organizações.

## 34. Regras para o Claude Code

1. Ler este ficheiro antes de alterar código.
2. Inspecionar a arquitetura existente.
3. Não implementar jogos fora do MVP sem pedido.
4. Não copiar código ou assets de terceiros.
5. Manter TypeScript estrito.
6. Não usar `any` sem justificação.
7. Validar cliente e servidor.
8. Autorizar no servidor.
9. Preservar isolamento multi-tenant.
10. Calcular a roda no servidor.
11. Usar transações para prémios.
12. Aplicar idempotência.
13. Não guardar dados pessoais em logs.
14. Não expor probabilidades.
15. Não alterar módulos não relacionados.
16. Reutilizar componentes.
17. Separar UI e lógica.
18. Adicionar testes à lógica crítica.
19. Garantir acessibilidade.
20. Garantir mobile first.
21. Usar migrações.
22. Não editar migrações aplicadas.
23. Não incluir segredos.
24. Executar lint, typecheck, testes e build.
25. Não afirmar que passaram sem executar.

## 35. Comandos

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Alterações à Roda da Sorte devem incluir testes de concorrência e idempotência.

## 36. Definição de concluído

Uma funcionalidade está concluída quando cumpre os requisitos, está tipada, tem validação e autorização, respeita multi-tenancy, funciona em mobile e desktop, é acessível, inclui estados de interface, não expõe dados sensíveis, tem testes, passa lint, typecheck, testes e build, e tem documentação atualizada.

## 37. Roadmap

### Fase 1
Autenticação, organizações, espaços, pastas, página inicial, editor base e media.

### Fase 2
Memória, Roda, Quiz, formulários, resultados e preview.

### Fase 3
URLs, QR Code, embed, agenda, leads, exportação e estatísticas.

### Fase 4
Versionamento, auditoria, códigos, segurança avançada, retenção e testes de carga.

### Fase 5
CRM, webhooks, API, domínios, mais jogos, multilingue, aprovações e planos comerciais.

## 38. Prioridade do produto

A plataforma deve permitir que equipas de marketing criem campanhas interativas eficazes, visualmente consistentes e mensuráveis, recolhendo leads de forma transparente e segura.

Prioridades: facilidade de criação, integridade dos prémios, privacidade, segurança, performance mobile, acessibilidade, clareza dos dados, personalização de marca e escalabilidade.

## 39. Identidade de marca (Caetano)

Esta plataforma é operada internamente pela Caetano. O backoffice usa a identidade Caetano como
tema visual base; cada campanha tem o seu próprio Brand Kit (secção 10), inicializado com estes
valores por defeito mas totalmente editável.

Fonte de verdade: Brand Book Caetano, abril 2026. Os valores abaixo são os da tabela
"04.2 Cores & Versões" (Digital/RGB) e estão implementados como tokens em `src/app/globals.css`.

Cores base e respetivos tons oficiais (sufixos `-80/-60/-40/-20`):

| Cor | Base | Tons |
| --- | --- | --- |
| Azul profundo (primária) | `#002E5D` | `#33587D` `#66829E` `#99ABBE` `#CCD5DF` |
| Ultra branco (primária) | `#FFFFFF` | — |
| Cinza antracite (neutra) | `#2E3A46` | `#58616B` `#828990` `#ABB0B5` `#D5D8DA` |
| Cinza médio (neutra) | `#9CAEB8` | `#B0BEC6` `#C4CED4` `#D7DFE3` `#EBEFF1` |
| Azul cyan (secundária) | `#00AEEF` | `#33BEF2` `#66CEF5` `#99DFF9` `#CCEFFC` |
| Verde eco (secundária) | `#49B489` | `#6DC3A1` `#92D2B8` `#B6E1D0` `#DBF0E7` |
| Laranja dinâmico (secundária) | `#FFA931` | `#FFBA5A` `#FFCB83` `#FFDDAD` `#FFEED6` |
| Amarelo liberdade (secundária) | `#FFD23F` | `#FFDB65` `#FFE48C` `#FFEDB2` `#FFF6D9` |

"Azul céu" (`#66CEF5`) e "verde pastel" (`#92D2B8`) são os tons claros do azul cyan e do verde
eco nomeados no manual (04.1).

Usar sempre os tons oficiais em vez de opacidade sobre a cor base — uma cor com alfa compõe-se
com o fundo e deixa de ser um valor oficial.

A paleta não tem vermelho. Para estados de erro/destrutivos existe um token funcional
documentado (`--color-danger`), porque o laranja dinâmico não cumpre o contraste mínimo da
WCAG 2.2 AA para texto. Nunca usar essa cor em comunicação de marca.

Tipografia: Montserrat — Light (300), Regular (400), Medium (500, usado na assinatura) e
Bold (700). O manual não inclui SemiBold.

Logótipo: o wordmark "caetano" é um desenho autoral, sem fonte associada, e o manual (03) proíbe
expressamente substituí-lo por qualquer fonte similar. Nunca o compor tipograficamente nem
reproduzir o desenho vetorial (propriedade da marca). O backoffice mostra o ficheiro oficial
carregado em `Organization.logoMediaId` (Identidade visual) e, na sua ausência, apenas o nome do
produto. Tamanho mínimo em digital: 14 px de altura. Cada campanha carrega o seu próprio
logótipo através do Brand Kit.
