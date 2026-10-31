# Cadernô Express — backend

API do Cadernô Express. O backend oferece identidade por magic link, catálogo versionado e rascunhos, checkout e licenças Cakto, publicação/exportação PNG e analytics. O backend é a autoridade para compras, acesso e conteúdo persistido. A interface web continua fora do escopo deste repositório.

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

As definições reais dos 16 modelos ainda precisam ser fornecidas; os testes usam um fixture de exemplo e não publicam modelos fictícios.

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

O SQLite usa um volume Docker persistente. Não apague o volume ao atualizar a aplicação.

### Login e pagamentos

Configure `AUTH_PUBLIC_APP_URL`, `SMTP_URL` e `EMAIL_FROM` para enviar links de acesso. Em produção, `AUTH_PUBLIC_APP_URL` precisa usar HTTPS; o cookie de sessão fica `Secure` e `HttpOnly`.

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

Os jobs de deploy de `development` (`dev`), `staging` e `production` rodam após push na branch correspondente, depois da CI, mas permanecem desativados até configurar as variáveis de habilitação. Para cada ambiente do GitHub, configure `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_PORT`, `HOSTINGER_APP_PATH` e `PUBLIC_URL`, além dos segredos `HOSTINGER_SSH_PRIVATE_KEY` e `HOSTINGER_KNOWN_HOSTS`. Habilite somente os destinos desejados com as variáveis de repositório `DEVELOPMENT_DEPLOY_ENABLED`, `STAGING_DEPLOY_ENABLED` e `PRODUCTION_DEPLOY_ENABLED` iguais a `true`.

Antes de ativar, cada diretório de aplicação na VPS precisa ter um `.env` válido, Docker Compose instalado e um caminho/volume próprio do ambiente. O deploy preserva `.env` e o volume persistente. Configure `staging` e `production` com as proteções de aprovação desejadas e mantenha o HTTPS no proxy Nginx.

O `main` do GitHub exige uma aprovação de revisão e o check `quality` para merge. Branch protection e variáveis/secrets são configurações do repositório, não arquivos versionados.
