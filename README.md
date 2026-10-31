# Cadernô Express — backend

API do Cadernô Express. A primeira sprint cobre a fundação do backend, o catálogo de modelos e rascunhos anônimos. O frontend e os fluxos de conta, Cakto, licenças e publicação entram em sprints futuras.

## Decisões técnicas

- [Design técnico](docs/design/technical-design.md)
- [ADR 0001 — Stack e arquitetura](docs/adr/0001-stack-e-arquitetura.md)
- [ADR 0002 — Cakto e autoridade de licenças](docs/adr/0002-cakto-e-licencas-como-autoridade-do-backend.md)
- [ADR 0003 — Rascunhos anônimos e versões](docs/adr/0003-rascunhos-anonimos-e-versao-de-modelo.md)

## Estado

Projeto em implementação na branch `feature/sprint-1-backend-foundation`.

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
npm audit --audit-level=high
```

GitHub Actions executa essas verificações e constrói a imagem em push e pull request. A regra `quality` precisa estar verde antes do merge.

## Deploy na Hostinger

O job de deploy roda após push em `main`, depois da CI, mas permanece desativado até configurar o ambiente `production` no GitHub. Para ativá-lo, configure `HOSTINGER_DEPLOY_ENABLED=true`, as variáveis `HOSTINGER_HOST`, `HOSTINGER_USER`, `HOSTINGER_SSH_PORT`, `HOSTINGER_APP_PATH` e `PRODUCTION_URL`, além dos segredos `HOSTINGER_SSH_PRIVATE_KEY` e `HOSTINGER_KNOWN_HOSTS`.

Antes de ativar, o diretório da aplicação na VPS precisa ter um `.env` válido e Docker Compose instalado. O deploy preserva `.env` e o volume persistente. Configure o ambiente `production` com as proteções de aprovação desejadas e mantenha o HTTPS no proxy Nginx.

O `main` do GitHub exige uma aprovação de revisão e o check `quality` para merge. Branch protection e variáveis/secrets são configurações do repositório, não arquivos versionados.
