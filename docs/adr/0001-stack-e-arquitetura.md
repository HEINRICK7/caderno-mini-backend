# ADR 0001 — Stack e arquitetura do backend

- **Status:** Aceita
- **Data:** 2026-10-31

## Contexto

O Cadernô Express será inicialmente um serviço pequeno, implantado em uma única VPS Hostinger. O MVP precisa de uma API tipada, persistência local simples e testes rápidos. A equipe quer manter limites claros entre regras de negócio e ferramentas externas sem criar camadas sem necessidade.

## Decisão

- Node.js 24 LTS e TypeScript em modo strict.
- Fastify 5 para HTTP, `inject` para testes de rotas e OpenAPI para o contrato.
- Zod para validação nos limites HTTP.
- SQLite em arquivo persistente, `better-sqlite3` e Drizzle ORM; migrations versionadas, chaves estrangeiras e WAL.
- Monólito modular com domínio, aplicação, infraestrutura, apresentação e composição.
- Vitest para testes; as features começam com testes antes da implementação.
- Docker Compose para execução local e implantação inicial em uma instância.
- GitHub Actions para lint, testes, build e auditoria em push e pull request.

## Consequências

- Uma instância evita administrar um serviço de banco separado e mantém a implantação simples.
- SQLite permite muitas leituras simultâneas e uma escrita concorrente; múltiplas instâncias ou concorrência de escrita maior exigem reavaliação.
- `better-sqlite3` é síncrono, adequado ao volume inicial; operações longas não devem bloquear o event loop.
- O SQLite persistente exige volume fora da imagem, backups e um procedimento de restauração antes do uso em produção.
- A aplicação pode crescer por módulos sem começar com microserviços ou abstrações genéricas.
- O deploy contínuo depende de configuração dos segredos/ambientes da VPS e não deve ser ativado sem essa configuração.

## Alternativas consideradas

- **PostgreSQL:** mais adequado a múltiplas instâncias e escrita concorrente, mas adiciona um serviço para o estágio atual.
- **NestJS:** oferece estrutura mais prescritiva, mas Fastify atende o tamanho e a necessidade de baixo overhead do MVP.
- **Redis, filas e microserviços:** sem necessidade de escala independente demonstrada; eventos externos serão inicialmente persistidos em uma inbox SQLite durável.

## Reavaliação

Revisar SQLite quando houver múltiplas instâncias, disputa relevante por escrita, recuperação de desastre que exija replicação ou consultas/conexões que ultrapassem a capacidade operacional da VPS.

## Referências

- Node.js — Releases: https://nodejs.org/en/about/previous-releases
- Fastify — TypeScript: https://fastify.dev/docs/latest/Reference/TypeScript/
- Drizzle ORM — SQLite: https://orm.drizzle.team/docs/sqlite/get-started-sqlite
- GitHub Actions — Node.js: https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs
