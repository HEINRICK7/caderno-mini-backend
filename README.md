# Cadernô Express — backend

API do Cadernô Express. O backend oferece identidade por magic link, catálogo versionado e rascunhos, checkout e licenças AbacatePay, publicação/exportação e analytics. O backend é a autoridade para compras, acesso e conteúdo persistido; o frontend Next.js interpreta as definições versionadas de cartão.

## Decisões técnicas

- [Design técnico](docs/design/technical-design.md)
- [ADR 0001 — Stack e arquitetura](docs/adr/0001-stack-e-arquitetura.md)
- [ADR 0002 — Cakto e autoridade de licenças (histórico; substituído pelo ADR 0005)](docs/adr/0002-cakto-e-licencas-como-autoridade-do-backend.md)
- [ADR 0005 — AbacatePay como provedor de checkout](docs/adr/0005-abacatepay-checkout.md)
- [ADR 0003 — Rascunhos anônimos e versões](docs/adr/0003-rascunhos-anonimos-e-versao-de-modelo.md)
- [ADR 0004 — Identidade por magic link e sessões](docs/adr/0004-identidade-magic-link-e-sessoes.md)

## Estado

O código está sendo finalizado em `feature/sprint-1-backend-foundation`. O fluxo de promoção é `feature/* → dev → staging → main`; cada etapa usa pull request e CI. A entrega automática de produção continua desligada até a configuração do ambiente `production` no GitHub.

## Recursos da API

- Sessões revogáveis por magic link, com rate limits, cookies seguros e checagem de origem em mutações de navegador.
- Templates versionados, validação por campo, rascunhos anônimos associados à conta após compra confirmada e prévia PNG gratuita, reduzida e com marca d'água, respeitando a propriedade.
- Checkout hospedado pela AbacatePay, inbox durável de webhooks assinados, processamento idempotente e licenças concedidas/revogadas exclusivamente no backend. O endpoint da Cakto continua ativo apenas para conciliar eventos de compras anteriores.
- Estado de compras e acesso da conta, publicação por slug aleatório, página pública e exportação PNG protegidas por licença ativa.
- Analytics de produto e conversão com deduplicação, retenção apenas do host de referência e endpoint de leitura protegido por token.
- SQLite com migrations, backup consistente e restauração coberta por teste de integração.

O catálogo oficial com os 16 modelos de referência está versionado em `catalog/templates.json`. Produtos e serviços recebem campos próprios definidos pelo backend; o frontend apenas renderiza e valida esses contratos.

### Catálogo de modelos

Cada item informa `id`, `version`, `name`, `description`, `definition` e `isActive`; `definition.fields` aceita campos de texto, data, valor, link e imagem, com rótulo, limite, ajuda e seção. `definition.card` declara a ilustração da prancha, o título, a mensagem, os detalhes e as ações ligadas a campos do próprio formulário. `definition.visual` define a paleta e aceita somente valores validados. O frontend converte essa estrutura semântica em HTML/SVG com CSS próprio; o backend renderiza SVG/PNG para exportação e metadados de compartilhamento, sem aceitar HTML ou CSS arbitrário. O carregador insere o lote em uma transação, impede alterações no conteúdo de uma versão já publicada e desativa a versão anterior quando uma nova versão é ativada. Não há rota pública para editar o catálogo.

Execute `npm run db:seed:catalog` localmente. No container de produção, após atualizar a imagem com o arquivo de catálogo, execute `docker compose exec api npm run db:seed:catalog:prod`. A operação aplica migrations pendentes antes da importação e pode ser repetida com segurança.

## Rodar localmente

Requer Node.js 24 e npm. Copie o arquivo de exemplo e instale as dependências:

```sh
cp .env.example .env
npm ci
npm run dev
```

A API fica em `http://localhost:3000`. O health check responde em `/health`; a especificação OpenAPI fica em `/openapi.json`.

Também é possível subir pelo Docker Compose:

```sh
cp .env.example .env
docker compose up --build
```

Configure `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` e `MINIO_BUCKET` para apontar ao endpoint S3 do MinIO. O endpoint é o host sem `https://` (use a porta da API S3, não a do console), e o bucket precisa existir antes de iniciar uploads. Em produção, MinIO usa TLS e credenciais próprias do backend com acesso limitado aos objetos desse bucket. Não coloque credenciais reais no `.env.example`, em commits ou em mensagens.

O SQLite usa um volume Docker persistente. Não apague o volume ao atualizar a aplicação.

### Login e pagamentos

Configure `AUTH_PUBLIC_APP_URL`, `PUBLIC_API_URL`, `PUBLIC_APP_URL`, `SMTP_URL` e `EMAIL_FROM` para enviar links de acesso e compartilhar publicações. `PUBLIC_APP_URL` é a origem do frontend Next.js usada nos links compartilhados; `PUBLIC_API_URL` fornece a imagem Open Graph para a prévia automática do WhatsApp. A página Next.js monta a versão publicada do cartão em HTML; a imagem Open Graph não substitui o cartão exibido ao abrir o link. Em produção, as URLs públicas precisam usar HTTPS; o cookie de sessão fica `Secure` e `HttpOnly`.

No GitHub Environment, configure os segredos `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET`, e a variável `ABACATEPAY_WEBHOOK_SIGNATURE_KEY` com a chave pública documentada pela AbacatePay para validar `X-Webhook-Signature`. Esses valores habilitam o recebimento de webhooks. Para habilitar novos checkouts, configure também os dois IDs reais `ABACATEPAY_PRODUCT_ANNUAL_ID` e `ABACATEPAY_PRODUCT_LIFETIME_ID`; configure o anual conforme o fluxo escolhido no dashboard (compra única ou recorrência anual) e o vitalício como compra única. Sem os dois IDs, o webhook segue disponível e a criação de checkout responde como indisponível. A chave precisa da permissão `CHECKOUT:CREATE` para criar checkouts. O workflow grava os valores em `.env.abacatepay`, com permissão restrita. Não envie credenciais em commits ou logs.

Gere o segredo do webhook no terminal com `openssl rand -hex 32`. Cadastre exatamente o mesmo valor como secret `ABACATEPAY_WEBHOOK_SECRET` no ambiente GitHub de deploy e no campo **Secret** do webhook v2 da AbacatePay. O valor não fica no repositório e não deve ser enviado por chat.

O código registra `POST /api/v1/webhooks/abacatepay`, mas essa URL só deve ser cadastrada na AbacatePay depois que o deploy publicar a rota. Confirme no OpenAPI público que a rota existe e faça um evento no Sandbox responder `2xx`; o domínio da API sozinho não confirma que o controller chegou ao deploy. Depois de publicado, selecione os oito eventos: `checkout.completed`, `checkout.refunded`, `checkout.disputed`, `checkout.lost`, `subscription.completed`, `subscription.renewed`, `subscription.cancelled` e `subscription.payment_failed`. Assinaturas só concedem ou estendem o acesso quando o produto é o anual configurado, a frequência vem como `ANNUALLY` e o `externalId` ou checkout já vinculado identifica a compra local. O `checkout.completed` com frequência `SUBSCRIPTION` é aceito sem repetir a concessão: a fonte da assinatura são os eventos `subscription.*`. A falha de cobrança preserva o período já pago; `NEXT_CYCLE` preserva acesso até o vencimento e `NOW` revoga imediatamente.

O endpoint antigo `POST /api/v1/webhooks/cakto` e os valores legados em `.env.cakto` podem ser mantidos durante a migração para processar pagamentos e reembolsos iniciados antes da troca. Eles não criam novos checkouts. Após conciliar os pedidos pendentes e confirmar que os webhooks antigos não são mais necessários, remova as credenciais antigas.

### Painel do criador e suporte

O painel `/admin` tem um login separado dos clientes: usa e-mail e senha do administrador, cria uma sessão protegida por cookie `HttpOnly` com validade de 8 horas e limita tentativas de senha. A senha é guardada no servidor somente como hash scrypt. Clientes continuam acessando a própria conta com o link enviado por e-mail.

Para configurar o administrador em desenvolvimento, gere o hash da senha com `npm run admin:hash-password` em um terminal interativo e informe `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` e `ADMIN_SESSION_SECRET` no `.env`. Gere o segredo de sessão com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Em produção, cadastre esses três valores como segredos do ambiente GitHub `production`; o deploy os grava em `.env.admin` com permissão restrita. Não cadastre a senha original como segredo nem a envie por chat. Depois do deploy, entre em `/admin` com as credenciais configuradas.

O painel lista e busca clientes, mostra compras, licenças, sessões e rascunhos, e permite suspender/reativar uma conta. Suspender encerra sessões existentes, bloqueia novas sessões e grava a ação no histórico administrativo. O painel não concede nem remove licença paga; esses estados continuam sendo derivados dos eventos assinados da AbacatePay. Uma compra paga de ponta a ponta pode ser validada no Modo Teste da AbacatePay com o webhook de teste configurado.

### Backup SQLite

Gere um snapshot consistente do banco em execução e escolha um nome novo para cada arquivo. Em desenvolvimento, compile antes de usar o comando de produção ou use `db:backup:dev`:

```sh
npm run build
BACKUP_FILE="./backups/caderno-mini-$(date +%Y%m%d-%H%M%S).sqlite" npm run db:backup
```

O comando cria o diretório quando necessário, grava o arquivo com permissão `0600` e recusa sobrescrever backups existentes. O banco SQLite e seus arquivos WAL também ficam com permissão `0600`. Armazene uma cópia fora da VPS para proteger contra perda do servidor. A suíte de integração verifica a restauração abrindo o snapshot e recuperando um rascunho persistido.

No Compose, o comando de produção roda dentro da API e grava um snapshot no volume persistente:

```sh
docker compose exec -e BACKUP_FILE="/app/data/backups/caderno-mini-$(date +%Y%m%d-%H%M%S).sqlite" api npm run db:backup
```

Transfira esse arquivo para armazenamento fora da VPS. A etapa de transferência e retenção deve ser agendada no ambiente de produção.

## Verificações locais

```sh
npm run lint
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm audit --audit-level=moderate
```

GitHub Actions executa essas verificações e constrói a imagem em push e pull request para `dev`, `staging` e `main`. Configure essas branches com proteção de PR, CI verde e ao menos uma revisão. As regras de proteção são configurações do repositório e não podem ser definidas pelo workflow versionado.

Fluxo de promoção: feature abre PR para `dev`; depois da revisão e merge, `dev` abre PR para `staging`; após validação de homologação, `staging` abre PR para `main`. Não faça merge direto entre essas etapas.

## Deploy na Hostinger

O deploy de `production` roda somente após merge em `main`, com a CI verde e `PRODUCTION_DEPLOY_ENABLED=true`. No ambiente GitHub `production`, configure `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_PORT`, `HOSTINGER_APP_PATH`, `HOSTINGER_API_PORT` e `PUBLIC_URL`, além dos segredos `HOSTINGER_SSH_PRIVATE_KEY` e `HOSTINGER_KNOWN_HOSTS`. `ABACATEPAY_API_KEY` e `ABACATEPAY_WEBHOOK_SECRET` habilitam o webhook; `ABACATEPAY_WEBHOOK_SIGNATURE_KEY` é uma variável pública necessária para verificar a assinatura do provedor. Os IDs `ABACATEPAY_PRODUCT_ANNUAL_ID` e `ABACATEPAY_PRODUCT_LIFETIME_ID` são opcionais para o deploy e devem ser definidos em par para habilitar checkouts. O deploy grava esses valores em `.env.abacatepay`, dentro do diretório isolado do backend, com permissão restrita. `HOSTINGER_APP_PATH` deve ser um diretório exclusivo terminado em `/caderno-mini/backend`; `HOSTINGER_API_PORT` deve ser uma porta livre de loopback entre 1024 e 65535. O workflow interrompe o deploy se o diretório já tiver conteúdo sem o marcador Cadernô, se a porta estiver ocupada por outro serviço, ou se a rede Docker não estiver marcada como pertencente à produção Cadernô. A configuração Cakto pode permanecer no `.env.cakto` existente até encerrar a conciliação de pedidos antigos.

Antes de ativar, crie o `.env` de produção no diretório exclusivo, configure MinIO com TLS e credenciais próprias, e confirme que Docker Compose, `rsync`, `ssh` e `ss` estão instalados no VPS. O deploy não apaga arquivos no destino, preserva `.env` e mantém o volume SQLite do projeto. A rede privada `caderno-mini-production` conecta apenas os containers do frontend e backend; o proxy HTTPS existente deve apontar o domínio para a porta local configurada, sem substituir a configuração de outros sites. O catálogo oficial é atualizado de forma idempotente depois do health check.

O `main` do GitHub exige uma aprovação de revisão e o check `quality` para merge. Branch protection e variáveis/secrets são configurações do repositório, não arquivos versionados.
