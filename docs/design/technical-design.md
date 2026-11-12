# Design técnico — Cadernô Express (backend)

**Status:** módulos do backend implementados na branch da PR #1; resta revisão, dados reais dos modelos e configuração dos ambientes externos
**Escopo deste documento:** backend completo do MVP, sem interface web
**Stack escolhida:** Node.js 24, TypeScript strict, Fastify 5, SQLite, Drizzle ORM e Zod

## Contexto e objetivo

O Cadernô Express permite que uma pessoa escolha um modelo, personalize uma mensagem, veja uma prévia e solicite compartilhamento ou exportação. O visitante poderá começar sem cadastro. Compras são feitas no checkout hospedado da AbacatePay; o backend mantém os estados locais de compra e licença e controla todo acesso pago. O frontend Next.js interpreta os contratos do backend e não define catálogo, conteúdo ou estado de acesso por conta própria.

A API inclui identidade, validação de modelos, rascunhos e associação pós-compra, checkout e licenças AbacatePay, publicação/exportação, analytics, e-mail transacional e persistência em SQLite. A aplicação Next.js fica no repositório `mini-frontend` e transforma a definição de cartão versionada em componentes HTML/CSS.

## Princípios

- O backend é a autoridade para dados persistidos, estado de compra e concessão de acesso.
- O cliente pode solicitar operações, mas não pode declarar que uma compra foi paga, conceder licença ou escolher um estado privilegiado.
- O domínio não depende de Fastify, Drizzle, SQLite ou AbacatePay.
- A AbacatePay fornece evidência de pagamento por eventos assinados; o backend valida essa evidência e decide a licença local.
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
│   ├── payments/abacatepay/
│   ├── payments/cakto/       # somente para conciliar pagamentos antigos
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
| `POST /api/v1/assets`, `GET /api/v1/assets/:id/content` | Valida e armazena imagens no MinIO e as serve por UUID opaco |
| `POST /api/v1/drafts` | Cria um rascunho anônimo associado a um modelo/versão |
| `GET /api/v1/drafts/:id` | Recupera um rascunho pelo identificador opaco |
| `PUT /api/v1/drafts/:id` | Substitui os dados personalizados do rascunho |
| `GET /api/v1/drafts/:id/preview.png` | Renderiza prévia PNG reduzida e com marca d'água sem licença, respeitando a propriedade do rascunho |
| `POST /api/v1/auth/magic-link` | Solicita um link de acesso por e-mail; resposta não revela cadastro |
| `POST /api/v1/auth/verify` | Consome o link e abre sessão por cookie seguro |
| `GET /api/v1/auth/session`, `DELETE /api/v1/auth/session` | Consulta ou revoga a sessão atual |
| `POST /api/v1/checkout` | Cria compra pendente e checkout AbacatePay com `externalId` opaco |
| `POST /api/v1/webhooks/abacatepay` | Confere secret e assinatura HMAC e persiste eventos na inbox antes de responder `202` |
| `POST /api/v1/webhooks/cakto` | Mantido para validar eventos atrasados de compras antigas durante a migração |
| `GET /api/v1/account/access`, `GET /api/v1/purchases/:id` | Expõe compras e acesso da sessão atual |
| `POST /api/v1/drafts/:id/publication`, `PUT /api/v1/drafts/:id/publication`, `DELETE /api/v1/drafts/:id/publication` | Publica, atualiza ou remove uma publicação licenciada |
| `GET /api/v1/publications/:slug`, `GET /api/v1/publications/:slug.png`, `GET /p/:slug` | Serve a mensagem publicada em JSON, PNG ou página HTML |
| `GET /api/v1/drafts/:id/export.png` | Exporta PNG de um rascunho com sessão e licença ativa |
| `POST /api/v1/analytics/events`, `GET /api/v1/analytics/summary` | Registra eventos permitidos e oferece resumo agregado protegido por token |
| `GET /openapi.json` | Especificação OpenAPI gerada a partir das rotas |

O rascunho guarda `id`, `templateId`, `templateVersion`, `data`, `createdAt` e `updatedAt`. A versão do modelo fica fixa no rascunho para que mudanças futuras no catálogo não alterem criações existentes.

Campos de imagem fazem upload pela API: o backend valida PNG, JPEG ou WebP de até 128 KiB, cria um UUID e grava os bytes no bucket MinIO configurado. O rascunho e os campos de logo/produto guardam somente o UUID; a API serve o conteúdo com MIME validado e cabeçalhos de conteúdo seguro. As imagens públicas usam UUID como caminho não enumerável porque a prévia HTML e os links compartilhados precisam carregá-las. Portanto, arquivos enviados para esses campos devem ser adequados para aparecer numa mensagem compartilhada. O bucket é criado previamente e a credencial da aplicação só precisa ler e gravar objetos nele; produção exige TLS.

O conteúdo de `data` é um objeto JSON validado no limite HTTP. As regras campo a campo dependem das definições dos 16 modelos, que ainda não foram fornecidas; até lá o catálogo de produção não terá modelos inventados. Testes e desenvolvimento usarão um fixture explicitamente marcado como exemplo.

O catálogo de produção é importado por `npm run db:seed:catalog` a partir do caminho `TEMPLATE_CATALOG_FILE` e precisa conter exatamente os 16 modelos oficiais. A definição contém campos do formulário, uma composição semântica obrigatória do cartão (ilustração permitida, título, mensagem e referências a campos) e um estilo visual declarativo obrigatório, validado pelo backend; HTML/CSS arbitrário não é aceito. O Next.js mapeia essa definição para HTML/SVG e CSS na prévia do editor e na página pública. O backend também renderiza SVG e PNG para exportação e para metadados de compartilhamento; a página aberta pelo link exibe o cartão HTML, não a imagem PNG. A carga é transacional e idempotente; uma versão existente só pode ter seu estado ativo alterado, enquanto mudanças de nome, descrição ou definição exigem nova versão. A nova versão ativa desativa a anterior. A importação usa o mesmo validador de campos da API, e o catálogo permanece fora de rotas públicas de escrita.

Publicações retornam `publicUrl`, construído a partir de `PUBLIC_APP_URL` confiável. A página Next.js `/p/:slug` busca JSON versionado da API, renderiza o cartão em HTML e gera os metadados Open Graph/Twitter. A imagem de metadados é fornecida por `PUBLIC_API_URL` para a prévia automática do WhatsApp; ela não é exibida como conteúdo da página. O slug e o renderizador continuam subordinados à licença ativa.

## Persistência

SQLite é suficiente para uma única instância inicial na VPS e evita administrar um serviço de banco separado. O acesso ocorre por Drizzle e `better-sqlite3`; schema e migrations ficam versionados. A conexão habilita chaves estrangeiras e WAL. O arquivo fica em volume persistente fora da imagem Docker.

O banco SQLite e arquivos auxiliares WAL ficam com permissão `0600`; novos diretórios de banco são criados com `0700`. O comando `npm run db:backup`, com `BACKUP_FILE` apontando para um caminho novo, usa a API de backup do SQLite para gerar um snapshot consistente e restringe as permissões do arquivo. O teste de integração abre esse snapshot como banco restaurado e recupera um rascunho. A cópia deve ser transferida e retida fora da VPS; a agenda dessa transferência será configurada na operação do ambiente.

As migrations versionadas cobrem:

- `templates` e `drafts`: versões imutáveis de modelos e dados personalizados, com proprietário opcional após a associação da conta.
- `users`, `magic_login_tokens` e `sessions`: identidade verificada, tokens de uso único e sessões revogáveis; tokens são armazenados somente como hashes.
- `purchases` e `access_grants`: ledger local de pedidos e concessões/revogações de acesso.
- `webhook_events`: inbox durável com ID de entrega único, estado de processamento, contagem de tentativas e erro sanitizado. `webhook_event_effects` impõe idempotência adicional pelo checkout, assinatura ou pagamento para reenvios manuais com novo ID de entrega.
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

## AbacatePay, compras e autoridade do backend

O checkout ativo é hospedado pela AbacatePay. O backend recebe `ABACATEPAY_API_KEY`, `ABACATEPAY_WEBHOOK_SECRET` e os IDs dos produtos anual e vitalício somente por variáveis de ambiente; a chave precisa da permissão `CHECKOUT:CREATE`. Os produtos de compra única são criados previamente no dashboard.

1. O backend cria um token opaco aleatório, usa esse token como `externalId` do checkout e guarda somente seu hash junto da compra local pendente. Dados pessoais não entram no identificador. A API envia o ID do produto configurado, URL de retorno e URL de conclusão; o navegador não escolhe o valor, produto nem URL do checkout.
2. A tela de retorno consulta a compra autenticada no backend. Retorno, query string e tela de sucesso do provedor nunca confirmam pagamento nem liberam acesso.
3. O webhook exige o secret configurado e `X-Webhook-Signature`. O backend confere o secret em tempo constante e valida HMAC-SHA256 sobre o corpo bruto antes do parse JSON, conforme a chave pública de assinatura documentada pela AbacatePay. Credenciais privadas ficam em ambiente; o endpoint só aceita HTTPS público na configuração do provedor.
4. `checkout.completed` com status `PAID` pode conceder licença, numa transação local. `checkout.refunded` revoga após reembolso confirmado; disputa ainda `UNDER_DISPUTE` não revoga, e disputa perdida/`checkout.lost` revoga. Evento de upsell não concede nem altera licença do produto principal.
5. A idempotência usa o ID da entrega do webhook e o backend grava o evento normalizado na inbox antes de responder `202`. O worker local processa a inbox depois da gravação e pode recuperar eventos após reinício.
6. O processador aceita somente os IDs de produto configurados, associa o evento pelo `externalId` opaco ou pelo ID de checkout já conhecido, e persiste apenas os campos necessários para correlação, deduplicação, licença e auditoria.

O endpoint antigo da Cakto permanece exclusivamente para eventos atrasados de compras anteriores. As configurações antigas em `.env.cakto` podem ficar durante a transição; elas não participam da criação de novos checkouts. Remova-as depois de conciliar compras pendentes e confirmar que não há mais eventos de reembolso/contestação esperados.

## Segurança e privacidade

- Rascunhos anônimos usam UUIDs aleatórios; o identificador funciona como capacidade de leitura/edição e deve ser tratado como segredo de acesso.
- Limite de tamanho do corpo e validação de esquema evitam payloads excessivos ou inválidos.
- Nenhum campo de entrada do cliente representa compra aprovada, licença, proprietário verificado ou papel administrativo.
- Logs não incluem corpo de rascunhos, segredos ou identificadores opacos de checkout. Dados pessoais recebidos dos provedores são minimizados.
- A política e o prazo de retenção de rascunhos anônimos precisam ser definidos antes de habilitar a operação pública; não são inventados no código.
- Segredos do deploy, SMTP e webhook são configuração de ambiente e nunca entram no repositório.

## CI e entrega

GitHub Actions roda em push e pull request para `dev`, `staging` e `main`: `npm ci`, lint, testes unitários, de integração e E2E, build TypeScript, build Docker e auditoria de dependências. O fluxo é `feature/* → dev → staging → main`, promovido por PR e CI verde. Jobs de CD para desenvolvimento, homologação e produção só rodam após push na branch correspondente, CI verde e habilitação explícita por variável de ambiente.

Docker Compose fornece execução local/na VPS, volume persistente do SQLite e health check HTTP. O CI valida a configuração e constrói a imagem, sem publicar ou implantar produção a partir da branch de feature.

## Dados e configuração pendentes para operação real

- Conteúdo, nomes, versões e campos dos 16 modelos.
- Prazo e rotina de expiração/remoção de rascunhos anônimos.
- IDs dos produtos anual e vitalício da AbacatePay e eventos habilitados no webhook de cada ambiente.
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
- Nenhuma licença pode ser concedida por comportamento de cliente; a integração AbacatePay valida secret, assinatura, idempotência e regra de aprovação.

## Critérios de finalização do backend

- Identity permite solicitar e consumir link de uso único, manter/consultar/revogar sessão e associar rascunho sem expor se um e-mail já está cadastrado.
- Templates e rascunhos oferecem catálogo versionado, validação de conteúdo, prévia PNG reduzida e com marca d'água sem licença e recuperação autenticada quando houver proprietário.
- Commerce cria o checkout configurado, recebe eventos AbacatePay autenticados em inbox durável, processa-os com idempotência e expõe estado de compra/licença derivado no servidor.
- Somente `purchase_approved` com estado `paid` concede acesso; `pix_gerado`, outros estados pendentes, redirect do navegador e campos do cliente nunca concedem licença. Reembolso efetivo/chargeback atualizam e podem revogar o acesso; `refund_requested` sozinho não revoga.
- Publishing cria, atualiza, remove, serve por link público não enumerável e exporta mensagens sem permitir acesso a rascunhos privados.
- Analytics registra eventos permitidos sem confiar em conversão/pagamento declarados pelo navegador e sem armazenar dados pessoais desnecessários.
- Migrations, OpenAPI, configuração, logs, backup/restore, CI, testes e documentação cobrem os fluxos implementados. Integrações externas são exercitadas por adaptadores falsos nos testes; validação real da AbacatePay ocorre quando produtos, eventos e secrets forem configurados em homologação.
