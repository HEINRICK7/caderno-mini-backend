# ADR 0002 — Cakto como evidência de pagamento e backend como autoridade de acesso

- **Status:** Aceita
- **Data:** 2026-10-31

## Contexto

O produto usará checkout Cakto. O comprador pode voltar ao site pelo navegador, fechar a página de aprovação ou pagar um Pix em outro dispositivo. A URL de retorno, portanto, não é uma confirmação confiável de pagamento. O cliente também não pode alterar o estado de uma compra ou licença.

## Decisão

- O backend é a única autoridade local para compras, licenças e acesso ao conteúdo pago.
- A Cakto é a fonte externa de evidência do pagamento. O backend só concede licença após aceitar um evento autenticado de pagamento aprovado e aplicar as regras locais.
- O backend associa uma sessão de checkout e um rascunho por token `callback` opaco, aleatório e sem dados pessoais. A relação entre token, pedido e rascunho fica persistida no backend.
- O redirect pós-pagamento é somente navegação. A tela de retorno consulta o backend; ela nunca envia um sinal que conceda licença.
- O evento `purchase_approved` com estado `paid` pode conceder a licença. `pix_gerado`, boleto gerado e demais eventos de cobrança pendente não concedem acesso.
- Reembolso e chargeback levam a atualização do estado e revogação conforme o estado final validado. `refund_requested` isoladamente representa solicitação e não confirma que o reembolso foi realizado.
- O adaptador verifica `X-Cakto-Timestamp` e `X-Cakto-Signature` sobre os bytes originais da requisição usando HMAC-SHA256, limite de cinco minutos e comparação em tempo constante. Segredo em variável de ambiente; HTTPS; sem registrar o segredo ou o corpo.
- A entrada suporta `data` como objeto (V1) e lista (V2). Cada pedido da lista é validado e processado separadamente.
- O sistema persiste uma inbox normalizada antes de responder `2xx`; o processamento de compra/licença ocorre de modo idempotente e transacional.
- A deduplicação considera o ID do pedido, tipo do evento e hash do payload, permitindo ignorar repetição sem descartar atualização posterior do mesmo pedido.
- Dados pessoais da entrega são minimizados e não armazenados na inbox se não forem necessários para correlação, suporte ou decisão de acesso.

## Consequências

- Webhook válido e persistido, não redirect, é a entrada de autoridade para a regra de licença.
- Uma repetição de webhook não cria licenças duplicadas nem desfaz um estado mais recente.
- Como a Cakto não retenta automaticamente respostas não-2xx, o endpoint só confirma após persistência durável. Falhas de persistência precisam de monitoramento e reconciliação/reenvio pelo histórico da Cakto.
- Integração requer acesso ao segredo do webhook e configuração HTTPS. A validação por assinatura usa o corpo bruto, que precisa ser capturado antes do parser JSON.
- O recurso de redirect `{{callback}}` exige liberação da Cakto caso seja usado; checkout e licenças não dependem desse recurso.

## Alternativas consideradas

- **Liberar acesso no redirect do navegador:** rejeitada porque depende do navegador e pode ser forjada ou não ocorrer.
- **Confiar em parâmetro enviado pelo frontend:** rejeitada porque o cliente pode alterar esses valores.
- **Conceder acesso em `pix_gerado`:** rejeitada porque o evento significa cobrança gerada e aguardando pagamento.
- **Persistir o payload completo do webhook:** rejeitada como padrão por conter dados pessoais e o campo `secret`; manter apenas os campos normalizados estritamente necessários.

## Referências

- Guia de Webhooks da Cakto: https://docs.cakto.com.br/conceitos/webhooks
- Redirect pós-pagamento da Cakto: https://docs.cakto.com.br/conceitos/redirect-pos-pagamento
