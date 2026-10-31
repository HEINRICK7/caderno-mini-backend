# Design técnico — Cadernô Express (backend)

**Status:** módulos do backend implementados na branch da PR #1; resta revisão, dados reais dos modelos e configuração dos ambientes externos
**Escopo deste documento:** backend completo do MVP, sem interface web
**Stack escolhida:** Node.js 24, TypeScript strict, Fastify 5, SQLite, Drizzle ORM e Zod

## Contexto e objetivo

O Cadernô Express permite que uma pessoa escolha um modelo, personalize uma mensagem, veja uma prévia e solicite compartilhamento ou exportação. O visitante poderá começar sem cadastro. Compras serão feitas no checkout da Cakto; o backend manterá os estados locais de compra e licença e controlará todo acesso pago.

A API inclui identidade, validação de modelos, rascunhos e associação pós-compra, checkout e licenças Cakto, publicação/exportação PNG, analytics, e-mail transacional e persistência em SQLite. A interface web continua fora do escopo.

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
│   ├── templates/
│   ├── identity/
│   ├── commerce/
│   └── publishing/
├── application/
│   ├── dto/
│   ├── ports/
│   └── use-cases/
├── infrastructure/
│   ├── payments/cakto/
│   ├── email/
│   ├── storage/
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
| `POST /api/v1/auth/magic-link` | Solicita um link de acesso por e-mail; resposta não revela cadastro |
| `POST /api/v1/auth/verify` | Consome o link e abre sessão por cookie seguro |
| `GET /api/v1/auth/session`, `DELETE /api/v1/auth/session` | Consulta ou revoga a sessão atual |
| `POST /api/v1/checkout` | Cria compra pendente e devolve link hospedado Cakto com `callback` opaco |
| `POST /api/v1/webhooks/cakto` | Verifica assinatura e persiste eventos na inbox antes de responder `202` |
| `GET /api/v1/account/access`, `GET /api/v1/purchases/:id` | Expõe compras e acesso da sessão atual |
| `POST /api/v1/drafts/:id/publication`, `PUT /api/v1/drafts/:id/publication`, `DELETE /api/v1/drafts/:id/publication` | Publica, atualiza ou remove uma publicação licenciada |
| `GET /api/v1/publications/:slug`, `GET /api/v1/publications/:slug.png`, `GET /p/:slug` | Serve a mensagem publicada em JSON, PNG ou página HTML |
| `GET /api/v1/drafts/:id/export.png` | Exporta PNG de um rascunho com sessão e licença ativa |
| `POST /api/v1/analytics/events`, `GET /api/v1/analytics/summary` | Registra eventos permitidos e oferece resumo agregado protegido por token |
| `GET /openapi.json` | Especificação OpenAPI gerada a partir das rotas |

O rascunho guarda `id`, `templateId`, `templateVersion`, `data`, `createdAt` e `updatedAt`. A versão do modelo fica fixa no rascunho para que mudanças futuras no catálogo não alterem criações existentes.

O conteúdo de `data` é um objeto JSON validado no limite HTTP. As regras campo a campo dependem das definições dos 16 modelos, que ainda não foram fornecidas; até lá o catálogo de produção não terá modelos inventados. Testes e desenvolvimento usarão um fixture explicitamente marcado como exemplo.

## Persistência

SQLite é suficiente para uma única instância inicial na VPS e evita administrar um serviço de banco separado. O acesso ocorre por Drizzle e `better-sqlite3`; schema e migrations ficam versionados. A conexão habilita chaves estrangeiras e WAL. O arquivo fica em volume persistente fora da imagem Docker.

O banco SQLite e arquivos auxiliares WAL ficam com permissão `0600`; novos diretórios de banco são criados com `0700`. O comando `npm run db:backup`, com `BACKUP_FILE` apontando para um caminho novo, usa a API de backup do SQLite para gerar um snapshot consistente e restringe as permissões do arquivo. O teste de integração abre esse snapshot como banco restaurado e recupera um rascunho. A cópia deve ser transferida e retida fora da VPS; a agenda dessa transferência será configurada na operação do ambiente.

As migrations versionadas cobrem:

- `templates` e `drafts`: versões imutáveis de modelos e dados personalizados, com proprietário opcional após a associação da conta.
- `users`, `magic_login_tokens` e `sessions`: identidade verificada, tokens de uso único e sessões revogáveis; tokens são armazenados somente como hashes.
- `purchases` e `access_grants`: ledger local de pedidos e concessões/revogações de acesso.
- `webhook_events`: inbox durável com chave de deduplicação, estado de processamento, contagem de tentativas e erro sanitizado.
- `publications`: slugs aleatórios e estado publicado/retirado para mensagens licenciadas.
- `analytics_events`: eventos permitidos, atribuição sanitizada e chave de deduplicação.

A inbox durável é a fronteira entre o recebimento rápido do provedor e o processamento idempotente das regras de negócio.

## Identidade e sessões

- Login sem senha por link de uso único enviado por e-mail. O token tem pelo menos 256 bits aleatórios; somente seu hash é persistido e o token expira após 15 minutos.
- O endpoint de solicitação sempre retorna a mesma resposta, independentemente de já existir usuário, para não revelar cadastros. Solicitações são limitadas por IP e endereço normalizado.
- A verificação consome o token uma única vez e cria/recupera a conta em uma transação. O e-mail fica normalizado e marcado como verificado apenas após o token correto.
- Sessões usam outro token aleatório, armazenado apenas como hash, com expiração e revogação no banco. O navegador recebe cookie `HttpOnly`, `Secure` em produção, `SameSite=Lax` e `Path=/`.
- O serviço de e-mail fica atrás de uma porta da aplicação. Erros não podem registrar token, link, segredo SMTP ou conteúdo de rascunho.
- Após consumir o link, o backend associa as compras e licenças ao e-mail verificado e atribui ao usuário os rascunhos dessas compras. Rascunhos sem compra permanecem anônimos; a licença ativa continua sendo necessária para operações pagas.

Rotas implementadas: `POST /api/v1/auth/magic-link`, `POST /api/v1/auth/verify`, `GET /api/v1/auth/session` e `DELETE /api/v1/auth/session`.

## Cakto, compras e autoridade do backend

Este fluxo está implementado. O identificador de produto e a URL da oferta são configuração do ambiente; não há credenciais Cakto dentro do código.

1. O backend cria uma compra local pendente para o rascunho e gera um `callback` opaco (32 bytes aleatórios em base64url, portanto com caracteres permitidos pela Cakto). A associação do hash do callback à compra/rascunho é guardada no servidor. O backend acrescenta `?callback=<token>` ao link hospedado configurado para a oferta; e-mail, nome, CPF e outros dados pessoais nunca entram nesse valor.
2. O browser pode voltar pela URL de redirect para uma tela de estado, mas essa navegação não confirma pagamento nem libera acesso.
3. O webhook é a entrada servidor-a-servidor. O backend valida `X-Cakto-Timestamp` e `X-Cakto-Signature` com HMAC-SHA256 sobre `timestamp + "." + corpo bruto`, com tolerância temporal de cinco minutos e comparação em tempo constante. O segredo fica em variável de ambiente; HTTPS é obrigatório; segredo e payload não são escritos nos logs.
4. O adaptador aceita o envelope V1 (objeto em `data`) e V2 (lista em `data`). `checkout_abandonment` usa outro formato e não tem ID de pedido, status nem valor; deve seguir um caminho separado de deduplicação.
5. Validada a assinatura, o evento normalizado é gravado duravelmente na inbox e o endpoint responde `2xx` sem aguardar regras de negócio. Um worker local processa a inbox depois da gravação; isso respeita o limite de resposta de 8 segundos e permite recuperação após reinício.
6. A chave de idempotência combina o pedido (`data.id`), o tipo do evento e um hash do payload recebido. Assim, uma repetição do mesmo evento é ignorada sem bloquear eventos posteriores, como reembolso ou chargeback, para o mesmo pedido.
7. `purchase_approved` com pedido pago pode conceder licença, em uma transação local. `pix_gerado` e outros eventos de cobrança gerada mantêm a compra pendente e não concedem acesso. `refund` com estado `refunded` e `chargeback` com estado final de contestação atualizam a compra e revogam o acesso. `refund_requested` sozinho não revoga. O retorno do checkout nunca é prova suficiente.
8. Dados pessoais desnecessários do payload não são persistidos. A ingestão guarda apenas os campos necessários para correlação, deduplicação, decisão de acesso e auditoria.

O contrato atual da Cakto prevê até cinco retentativas automáticas com espera crescente para falhas de rede/timeout que ocorram antes de uma resposta. Uma resposta HTTP não-2xx não é retentada automaticamente. Por isso, depois de verificar a assinatura, o endpoint confirma somente após persistir a inbox; falhas de persistência recebem erro e devem ser monitoradas e reconciliadas pelo histórico/reenvio manual da Cakto. A operação distingue evento recebido de evento processado e oferece retentativa local idempotente para falhas de processamento.

O `callback` da Cakto é um identificador definido pelo nosso sistema, aparece no redirect e no webhook e não deve conter nome, e-mail, CPF ou qualquer dado pessoal. O valor deve respeitar o charset permitido pela Cakto (letras, números, `.`, `_`, `~`, `-`) e até 255 caracteres. A funcionalidade de redirect pós-pagamento depende de liberação da Cakto; o sistema não depende desse redirect para liberar acesso. A URL de checkout vem de configuração de ambiente para que IDs de produto/oferta não sejam aceitos do navegador.

## Segurança e privacidade

- Rascunhos anônimos usam UUIDs aleatórios; o identificador funciona como capacidade de leitura/edição e deve ser tratado como segredo de acesso.
- Limite de tamanho do corpo e validação de esquema evitam payloads excessivos ou inválidos.
- Nenhum campo de entrada do cliente representa compra aprovada, licença, proprietário verificado ou papel administrativo.
- Logs não incluem corpo de rascunhos, segredos ou identificadores de callback. Dados pessoais recebidos da Cakto são minimizados.
- A política e o prazo de retenção de rascunhos anônimos precisam ser definidos antes de habilitar a operação pública; não são inventados no código.
- Segredos do deploy, SMTP e webhook são configuração de ambiente e nunca entram no repositório.

## CI e entrega

GitHub Actions roda em push e pull request para `dev`, `staging` e `main`: `npm ci`, lint, testes unitários, de integração e E2E, build TypeScript, build Docker e auditoria de dependências. O fluxo é `feature/* → dev → staging → main`, promovido por PR e CI verde. A publicação em VPS exige segredos e caminho de deploy da Hostinger; o job de produção só roda após push em `main` e quando `HOSTINGER_DEPLOY_ENABLED=true`.

Docker Compose fornece execução local/na VPS, volume persistente do SQLite e health check HTTP. O CI valida a configuração e constrói a imagem, sem publicar ou implantar produção a partir da branch de feature.

## Dados e configuração pendentes para operação real

- Conteúdo, nomes, versões e campos dos 16 modelos.
- Prazo e rotina de expiração/remoção de rascunhos anônimos.
- IDs de produto/oferta Cakto e eventos habilitados no webhook de produção.
- Conteúdo e regras de validação dos 16 modelos; não inventar os modelos de produção a partir do fixture.
- URL pública HTTPS, secrets, diretório e política de rollback da VPS Hostinger.
- Endereço público HTTPS do backend, SMTP, token de analytics e credenciais de deploy; configure-os em secrets/variáveis do ambiente, sem commitá-los.
- Política de expiração e remoção de rascunhos anônimos e agenda de cópia de backups para fora da VPS.
- Promoção das branches via PR: feature para `dev`, depois `staging` e `main`; regras de proteção devem ser habilitadas no GitHub.

## Critérios de aceite da primeira entrega

- CI roda automaticamente em push e PR para `dev`, `staging` e `main` e exige lint, testes, build de aplicação e Docker, e auditoria.
- Testes cobrem criação, recuperação, atualização, validação e não encontrado.
- API persiste rascunhos em SQLite, associa-os a uma versão de modelo e mantém alterações após reinício.
- A documentação OpenAPI reflete as rotas e schemas publicados.
- Docker Compose inicia API e banco persistente com health check.
- Nenhuma licença pode ser concedida por comportamento de cliente; a integração Cakto valida assinatura, idempotência e regra de aprovação.

## Critérios de finalização do backend

- Identity permite solicitar e consumir link de uso único, manter/consultar/revogar sessão e associar rascunho sem expor se um e-mail já está cadastrado.
- Templates e rascunhos oferecem catálogo versionado, validação de conteúdo, prévia e recuperação autenticada quando houver proprietário.
- Commerce cria o checkout configurado, recebe eventos Cakto assinados em inbox durável, processa-os com idempotência e expõe estado de compra/licença derivado no servidor.
- Somente `purchase_approved` com estado `paid` concede acesso; `pix_gerado`, outros estados pendentes, redirect do navegador e campos do cliente nunca concedem licença. Reembolso efetivo/chargeback atualizam e podem revogar o acesso; `refund_requested` sozinho não revoga.
- Publishing cria, atualiza, remove, serve por link público não enumerável e exporta mensagens sem permitir acesso a rascunhos privados.
- Analytics registra eventos permitidos sem confiar em conversão/pagamento declarados pelo navegador e sem armazenar dados pessoais desnecessários.
- Migrations, OpenAPI, configuração, logs, backup/restore, CI, testes e documentação cobrem os fluxos implementados. Integrações externas são exercitadas por adaptadores falsos nos testes; validação real da Cakto ocorre quando produto, eventos e secrets forem configurados em homologação.
