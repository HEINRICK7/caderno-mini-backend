# Design técnico — Cadernô Express (backend)

**Status:** proposta para Sprint 1  
**Escopo deste documento:** fundação e primeira entrega do backend  
**Stack escolhida:** Node.js 24, TypeScript strict, Fastify 5, SQLite, Drizzle ORM e Zod

## Contexto e objetivo

O Cadernô Express permite que uma pessoa escolha um modelo, personalize uma mensagem, veja uma prévia e solicite compartilhamento ou exportação. O visitante poderá começar sem cadastro. Compras serão feitas no checkout da Cakto; o backend manterá os estados locais de compra e licença e controlará todo acesso pago.

A primeira entrega implementa apenas o catálogo de modelos e rascunhos anônimos. Login, checkout, webhooks, licenças, publicação e analytics ficam para sprints posteriores. O frontend também fica fora desta sprint.

## Princípios

- O backend é a autoridade para dados persistidos, estado de compra e concessão de acesso.
- O cliente pode solicitar operações, mas não pode declarar que uma compra foi paga, conceder licença ou escolher um estado privilegiado.
- O domínio não depende de Fastify, Drizzle, SQLite ou Cakto.
- A Cakto fornece evidência de pagamento por eventos assinados; o backend valida essa evidência e decide a licença local.
- As features seguem TDD: teste primeiro, implementação depois.
- A arquitetura é um monólito modular, sem filas, Redis ou microserviços nesta fase.

## Arquitetura

```text
HTTP / Fastify
     │
     ▼
Presentation: rotas, schemas Zod e mapeamento HTTP
     │
     ▼
Application: casos de uso e portas
     │
     ▼
Domain: modelos e regras de negócio em TypeScript puro
     ▲
     │ implementa portas
Infrastructure: SQLite/Drizzle, migrations e adaptadores externos
```

O composition root monta os adaptadores e injeta as dependências. Não haverá camada vazia: cada módulo entra quando houver uma responsabilidade real.

Estrutura inicial prevista:

```text
apps/api/src/
├── domain/
│   ├── drafts/
│   └── templates/
├── application/
│   ├── dto/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   └── database/
│       ├── migrations/
│       ├── repositories/
│       └── schema/
├── presentation/
│   ├── routes/
│   └── schemas/
├── bootstrap/
└── server.ts
```

## Contratos HTTP iniciais

Prefixo versionado: `/api/v1`. Respostas de sucesso usam um envelope `data`; erros usam código estável e mensagem segura.

| Método e rota | Resultado |
| --- | --- |
| `GET /health` | Estado da aplicação e do banco para health check |
| `GET /api/v1/templates` | Lista modelos ativos e suas versões |
| `POST /api/v1/drafts` | Cria um rascunho anônimo associado a um modelo/versão |
| `GET /api/v1/drafts/:id` | Recupera um rascunho pelo identificador opaco |
| `PUT /api/v1/drafts/:id` | Substitui os dados personalizados do rascunho |
| `GET /openapi.json` e `/docs` | Especificação OpenAPI e interface da documentação |

O rascunho guarda `id`, `templateId`, `templateVersion`, `data`, `createdAt` e `updatedAt`. A versão do modelo fica fixa no rascunho para que mudanças futuras no catálogo não alterem criações existentes.

O conteúdo de `data` é um objeto JSON validado no limite HTTP. As regras campo a campo dependem das definições dos 16 modelos, que ainda não foram fornecidas; até lá o catálogo de produção não terá modelos inventados. Testes e desenvolvimento usarão um fixture explicitamente marcado como exemplo.

## Persistência

SQLite é suficiente para uma única instância inicial na VPS e evita administrar um serviço de banco separado. O acesso ocorre por Drizzle e `better-sqlite3`; schema e migrations ficam versionados. A conexão habilita chaves estrangeiras e WAL. O arquivo fica em volume persistente fora da imagem Docker.

Tabelas da Sprint 1:

- `templates`: id, versão, nome, descrição, definição JSON, ativo e data de criação. Versões publicadas são imutáveis.
- `drafts`: id UUID aleatório, modelo/versão, dados JSON e datas de criação/atualização.

As tabelas de usuários, sessões, compras, licenças, eventos da Cakto e publicações são adicionadas nas sprints correspondentes, com suas migrations. A tabela futura de webhooks servirá também como inbox durável e chave de idempotência.

## Cakto, compras e autoridade do backend

Este fluxo é uma decisão arquitetural para as próximas sprints; a integração não será implementada na Sprint 1.

1. O backend inicia o checkout e associa o rascunho a um token `callback` opaco, aleatório e sem dados pessoais. A associação token/rascunho é guardada no servidor.
2. O browser pode voltar pela URL de redirect para uma tela de estado, mas essa navegação não confirma pagamento nem libera acesso.
3. O webhook é a entrada servidor-a-servidor. O backend valida `X-Cakto-Timestamp` e `X-Cakto-Signature` com HMAC-SHA256 sobre `timestamp + "." + corpo bruto`, com tolerância temporal de cinco minutos e comparação em tempo constante. O segredo fica em variável de ambiente; HTTPS é obrigatório; segredo e payload não são escritos nos logs.
4. O adaptador aceita o envelope V1 (objeto em `data`) e V2 (lista em `data`), validando o formato antes de mapear os eventos.
5. Um evento só recebe `2xx` depois que sua forma normalizada foi gravada duravelmente. O trabalho de negócio ocorre após essa gravação. Isso permite responder dentro do limite da Cakto sem perder o evento em uma reinicialização.
6. A chave de idempotência combina o pedido (`data.id`), o tipo do evento e um hash do payload recebido. Assim, uma repetição do mesmo evento é ignorada sem bloquear eventos posteriores, como reembolso ou chargeback, para o mesmo pedido.
7. `purchase_approved` com pedido pago pode conceder licença, em uma transação local. `pix_gerado` e outros eventos de cobrança gerada mantêm a compra pendente e não concedem acesso. Reembolso e chargeback atualizam o estado e revogam acesso conforme a regra de negócio. O retorno do checkout nunca é prova suficiente.
8. Dados pessoais desnecessários do payload não são persistidos. A ingestão guarda apenas os campos necessários para correlação, deduplicação, decisão de acesso e auditoria.

Como a Cakto não retenta automaticamente respostas não-2xx, uma falha antes da gravação durável será alertada e tratada por reconciliação/reenvio pelo histórico de eventos. A operação do webhook deve distinguir claramente evento recebido de evento processado.

O `callback` da Cakto é um identificador definido pelo nosso sistema, aparece no redirect e no webhook e não deve conter nome, e-mail, CPF ou qualquer dado pessoal. A funcionalidade de redirect pós-pagamento depende de liberação da Cakto; o sistema não depende desse redirect para liberar acesso.

## Segurança e privacidade

- Rascunhos anônimos usam UUIDs aleatórios; o identificador funciona como capacidade de leitura/edição e deve ser tratado como segredo de acesso.
- Limite de tamanho do corpo e validação de esquema evitam payloads excessivos ou inválidos.
- Nenhum campo de entrada do cliente representa compra aprovada, licença, proprietário verificado ou papel administrativo.
- Logs não incluem corpo de rascunhos, segredos ou identificadores de callback. Dados pessoais recebidos da Cakto são minimizados.
- Política e prazo de retenção para rascunhos anônimos precisam ser definidos antes do deploy público; não serão inventados nesta sprint.
- Segredos do deploy, SMTP e webhook são configuração de ambiente e nunca entram no repositório.

## CI e entrega

GitHub Actions roda em push e pull request para `main`: `npm ci`, lint, testes unitários e de integração, build TypeScript e auditoria de dependências. A branch de feature só avança com CI verde. A publicação em VPS requer os segredos e caminho de deploy da Hostinger; o workflow de deploy ficará condicionado a essas configurações e a um merge revisado.

Docker Compose fornece execução local/na VPS, volume persistente do SQLite e health check HTTP. O CI valida a configuração e constrói a imagem, sem publicar ou implantar produção a partir da branch de feature.

## Fora da Sprint 1

- Magic link, sessões e associação de rascunho à conta.
- Criar checkout na Cakto, validar webhooks reais, compras, licenças e reconciliação.
- Publicação de mensagens, links públicos, exportação e analytics.
- Interface web.

## Pendências para próximas decisões

- Conteúdo, nomes, versões e campos dos 16 modelos.
- Prazo e rotina de expiração/remoção de rascunhos anônimos.
- Produto/oferta Cakto e eventos que serão assinados no webhook.
- URL pública HTTPS, secrets, diretório e política de rollback da VPS Hostinger.
- Fluxo de identidade a usar para reclamar um rascunho após a compra.

## Critérios de aceite da primeira entrega

- CI roda automaticamente em push e PR e exige lint, testes, build e auditoria.
- Testes cobrem criação, recuperação, atualização, validação e não encontrado.
- API persiste rascunhos em SQLite, associa-os a uma versão de modelo e mantém alterações após reinício.
- A documentação OpenAPI reflete as rotas e schemas publicados.
- Docker Compose inicia API e banco persistente com health check.
- Nenhuma licença pode ser concedida por comportamento de cliente; o contrato futuro da Cakto está documentado com assinatura, idempotência e regra de aprovação.
