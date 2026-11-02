# ADR 0003 — Rascunhos anônimos e versões imutáveis de modelos

- **Status:** Aceita
- **Data:** 2026-10-31

## Contexto

O visitante começa a personalização antes de criar uma conta. Os modelos são conteúdo versionado e não devem mudar silenciosamente o significado de rascunhos já criados.

## Decisão

- Cada rascunho recebe um UUID aleatório gerado pelo backend e referencia um `templateId` e `templateVersion`.
- A versão de modelo é imutável após publicação. Alterar campos ou definição cria uma nova versão.
- O acesso anônimo ao rascunho exige seu identificador opaco; o identificador deve ser tratado como segredo e nunca colocado em logs ou telemetria pública.
- A API oferece criar, recuperar e substituir o objeto de dados do rascunho. Alterações são validadas no limite HTTP e persistidas pelo backend.
- O conteúdo das 16 definições reais dos modelos não foi fornecido; nenhuma definição de produção será inventada. Um fixture neutro pode existir apenas para desenvolvimento e testes.
- Prazo de retenção e expiração dos rascunhos permanece pendente e precisa ser decidido antes de exposição pública.

## Consequências

- O frontend não pode criar IDs, definir versões de catálogo ou decidir o que foi persistido.
- Versões imutáveis permitem renderizar e recuperar rascunhos com o contrato original.
- UUID não é autenticação de conta: quem obtiver o identificador terá acesso ao rascunho. Ao adicionar identidade, a reivindicação do rascunho precisa ser transacional e verificar a compra no backend.
- O conteúdo de modelos pode ser carregado por migrations/seed controlado; não haverá endpoint público de escrita no catálogo.

## Alternativas consideradas

- **ID sequencial ou curto:** rejeitada por facilitar enumeração de rascunhos.
- **Editar uma versão de modelo publicada:** rejeitada porque pode quebrar personalizações existentes.
- **Expor criação/edição de modelos sem autenticação:** rejeitada porque permitiria alterar o catálogo de produção.
