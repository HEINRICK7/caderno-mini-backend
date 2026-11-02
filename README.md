# Cadernô Express — backend

API do Cadernô Express. O backend oferece identidade por magic link, catálogo versionado e rascunhos, checkout e licenças Cakto, publicação/exportação e analytics. O backend é a autoridade para compras, acesso e conteúdo persistido; o frontend Next.js interpreta as definições versionadas de cartão.

## Decisões técnicas

- [Design técnico](docs/design/technical-design.md)
- [ADR 0001 — Stack e arquitetura](docs/adr/0001-stack-e-arquitetura.md)
- [ADR 0002 — Cakto e autoridade de licenças](docs/adr/0002-cakto-e-licencas-como-autoridade-do-backend.md)
- [ADR 0003 — Rascunhos anônimos e versões](docs/adr/0003-rascunhos-anonimos-e-versao-de-modelo.md)
- [ADR 0004 — Identidade por magic link e sessões](docs/adr/0004-identidade-magic-link-e-sessoes.md)

## Estado

O código está sendo finalizado em `feature/sprint-1-backend-foundation`. O fluxo de promoção é `feature/* → dev → staging → main`; cada etapa usa pull request e CI. A entrega automática de produção continua desligada até a configuração do ambiente `production` no GitHub.

## Recursos da API

- Sessões revogáveis por magic link, com rate limits, cookies seguros e checagem de origem em mutações de navegador.
- Templates versionados, validação por campo, rascunhos anônimos associados à conta após compra confirmada e prévia PNG gratuita, reduzida e com marca d'água, respeitando a propriedade.
- Checkout hospedado pela Cakto, inbox durável de webhooks assinados, processamento idempotente e licenças concedidas/revogadas exclusivamente no backend.
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

Para habilitar checkout, configure a URL da oferta hospedada em `CAKTO_CHECKOUT_URL` e o UUID do produto em `CAKTO_PRODUCT_ID`. Configure `CAKTO_WEBHOOK_SECRET` com o segredo do webhook criado no painel Cakto. Cadastre o endpoint `POST /api/v1/webhooks/cakto` e habilite os eventos de compra, pagamento, reembolso e chargeback. A URL de redirect do comprador não confirma pagamento; o acesso só muda após o worker processar o webhook assinado.

O backend não consulta a Cakto para autorizar cada requisição: a assinatura valida o evento recebido, e o ledger local guarda o estado derivado e idempotente. Para validar um ambiente real, faltam as configurações da oferta/produto, eventos habilitados e o segredo de webhook salvo como variável de ambiente; não envie o segredo em commits ou logs.

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

O deploy de `production` roda somente após push em `main`, com a CI verde e `PRODUCTION_DEPLOY_ENABLED=true`. No ambiente GitHub `production`, configure `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_PORT`, `HOSTINGER_APP_PATH`, `HOSTINGER_API_PORT` e `PUBLIC_URL`, além dos segredos `HOSTINGER_SSH_PRIVATE_KEY` e `HOSTINGER_KNOWN_HOSTS`. `HOSTINGER_APP_PATH` deve ser um diretório exclusivo terminado em `/caderno-mini/backend`; `HOSTINGER_API_PORT` deve ser uma porta livre de loopback entre 1024 e 65535. O workflow interrompe o deploy se o diretório já tiver conteúdo sem o marcador Cadernô, se a porta estiver ocupada por outro serviço, ou se a rede Docker não estiver marcada como pertencente à produção Cadernô.

Antes de ativar, crie o `.env` de produção no diretório exclusivo, configure MinIO com TLS e credenciais próprias, e confirme que Docker Compose, `rsync`, `ssh` e `ss` estão instalados no VPS. O deploy não apaga arquivos no destino, preserva `.env` e mantém o volume SQLite do projeto. A rede privada `caderno-mini-production` conecta apenas os containers do frontend e backend; o proxy HTTPS existente deve apontar o domínio para a porta local configurada, sem substituir a configuração de outros sites. O catálogo oficial é atualizado de forma idempotente depois do health check.

O `main` do GitHub exige uma aprovação de revisão e o check `quality` para merge. Branch protection e variáveis/secrets são configurações do repositório, não arquivos versionados.
