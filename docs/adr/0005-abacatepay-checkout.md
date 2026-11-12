# ADR 0005 — AbacatePay como provedor de checkout

- **Status:** Aceita
- **Data:** 2026-11-11

## Contexto

O Cadernô Express precisa cobrar pela publicação dos cartões e só conceder acesso após confirmação servidor-servidor. O checkout antigo usava ofertas hospedadas da Cakto. A integração será migrada para os checkouts hospedados da AbacatePay.

## Decisão

- A AbacatePay é o provedor ativo para criar novos checkouts, usando `POST /v2/checkouts/create`.
- O backend envia IDs de produtos previamente cadastrados, uma referência opaca `externalId`, e URLs de retorno/conclusão derivadas de origens configuradas no servidor.
- A chave de API e o secret do webhook ficam somente em variáveis de ambiente do backend. O navegador nunca recebe essas credenciais.
- O webhook v2 recebe `checkout.completed`, `checkout.refunded`, `checkout.disputed` e `checkout.lost`. Antes de persistir, o backend valida tanto `X-Webhook-Secret` quanto `X-Webhook-Signature` (HMAC-SHA256 sobre os bytes exatos do corpo).
- `checkout.completed` com `PAID` pode conceder licença; solicitação de disputa `UNDER_DISPUTE` não remove acesso; reembolso confirmado e disputa perdida podem revogar. Retornos de navegador nunca concedem acesso.
- A inbox durável, a deduplicação e o worker de compras continuam no backend. Somente os campos necessários à decisão e à associação da compra são normalizados e persistidos.
- O webhook e as configurações da Cakto ficam disponíveis apenas durante uma janela de migração para processar pagamentos, reembolsos ou disputas antigas. A Cakto não será usada para criar novos checkouts.

## Consequências

- Cada ambiente precisa de dois IDs de produtos AbacatePay, uma chave com `CHECKOUT:CREATE` e um secret de webhook com pelo menos 32 caracteres.
- Os produtos devem ser de compra única, sem ciclo recorrente, e os valores do catálogo de produtos devem corresponder aos planos exibidos no Cadernô.
- Webhooks separados de teste e produção devem apontar para `POST /api/v1/webhooks/abacatepay` em HTTPS público.
- Eventos atrasados da Cakto continuam conciliáveis enquanto as variáveis antigas e o endpoint legado permanecerem configurados.
- A integração real só estará ativa depois de cadastrar os IDs/segredos nos ambientes e configurar o webhook na AbacatePay.

## Alternativas consideradas

- **Conceder acesso no retorno do checkout:** rejeitada, pois o navegador não prova que o pagamento foi concluído.
- **Criar links de pagamento permanentes:** rejeitada para a cobrança por compra; o checkout individual usa `externalId` opaco para correlação e deduplicação.
- **Remover imediatamente o endpoint antigo da Cakto:** rejeitada durante a migração para não perder atualizações atrasadas de pagamentos já iniciados.

## Referências

- [Checkout de pagamento](https://docs.abacatepay.com/pages/cobrar/checkout)
- [Eventos de checkout](https://docs.abacatepay.com/pages/webhooks/events/checkout)
- [Segurança dos webhooks](https://docs.abacatepay.com/pages/notificacoes/seguranca)
