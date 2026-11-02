# Checklist: Cakto, acesso e demonstração do Cadernô Express

Escopo: deixar claro o caminho do checkout ao login e à publicação, permitir uma demonstração grátis compartilhável nas quatro categorias e ligar a compra da Cakto ao acesso do Cadernô. Manter as ofertas e os preços atuais; não executar compra real de teste.

## Estado conferido em 2 de novembro de 2026

- Cakto produção: produto **Cadernô Express** ativo, tipo pagamento único.
- Produto Cakto: `d74e1d7c-3200-4ff5-b074-4789940fb621`.
- Oferta encontrada: `34d9gvc`, R$ 67,00. Nenhuma oferta anual encontrada.
- Nenhum webhook aparece na listagem de produção da Cakto.
- `emailAccessLink` do produto está vazio.
- O ambiente GitHub `production` está sem as variáveis `CAKTO_CHECKOUT_URL` e `CAKTO_PRODUCT_ID`, e sem o segredo `CAKTO_WEBHOOK_SECRET`. O workflow exige os três juntos para publicar a configuração do checkout no backend.
- O gatilho `PRODUCTION_DEPLOY_ENABLED=true` foi configurado no ambiente `production`; o deploy só roda com push/merge em `main` e CI verde. Os dados de destino conferidos apontam para `/opt/caderno-mini/backend`, porta local `3224`, e URL `https://api.caderno-express.otimizanegocio.com`; o workflow recusa diretórios sem marcador Cadernô, portas ocupadas por outro serviço e redes Docker sem marcador de produção.
- As credenciais SSH de deploy existem no ambiente `production`; os três valores Cakto ainda faltam. O app poderá ser publicado após o merge mesmo antes do checkout, mas a compra só será habilitada depois de configurar o trio Cakto completo.
- As implementações foram enviadas para os PRs [backend #9](https://github.com/HEINRICK7/caderno-mini-backend/pull/9) e [frontend #4](https://github.com/HEINRICK7/caderno-mini-frontend/pull/4); CI passou nos dois. O backend requer revisão; o PR do frontend está em draft e depende do backend.
- A oferta atual segue ativa e custa R$ 67,00. O ID curto `34d9gvc` é a referência da URL hospedada atual; nenhuma oferta ou preço foi alterado.
- `https://api.caderno-express.otimizanegocio.com/health` respondeu HTTP 200. Isso não comprova que checkout, SMTP ou webhook estejam configurados.
- O código já valida a assinatura HMAC do webhook, guarda eventos numa inbox e associa a licença ao e-mail da compra depois da aprovação.
- O login é por magic link. O webhook pode chegar antes do cadastro; ao validar o mesmo e-mail da compra, o backend associa a licença à conta.
- O botão local de demonstração foi substituído por uma rota de demonstração persistida no backend. A implementação local ainda precisa ser publicada para estar disponível no domínio.
- O editor e a rota pública agora oferecem um link temporário por categoria e navegador, válido por sete dias; a demonstração não cria licença premium.
- A API de conta já listava as licenças. A interface agora expõe essa lista em **Minha conta** e permite criar/recuperar o link de uma compra ativa.

## Checklist de entrega

### Acesso pago e Cakto

- [x] Confirmar produto, oferta, webhook registrado e link de acesso do produto em modo somente leitura.
- [x] Confirmar endpoint público do backend e contrato de assinatura do webhook.
- [ ] Criar o webhook da Cakto inicialmente desativado para `https://api.caderno-express.otimizanegocio.com/api/v1/webhooks/cakto`, associado ao produto Cadernô Express.
- [ ] Habilitar `purchase_approved`, `purchase_refused`, `pix_gerado`, `refund`, `refund_requested` e `chargeback`.
- [ ] Guardar o segredo do webhook somente na configuração segura do backend como `CAKTO_WEBHOOK_SECRET`.
- [ ] Confirmar no backend de produção `CAKTO_PRODUCT_ID` igual ao UUID acima e `CAKTO_CHECKOUT_URL` igual ao link hospedado da oferta atual.
- [ ] Configurar o link de acesso enviado pela Cakto para `https://caderno-express.otimizanegocio.com/entrar` com instrução para usar o mesmo e-mail da compra.
- [ ] Confirmar `SMTP_URL`, `EMAIL_FROM` e `AUTH_PUBLIC_APP_URL` no ambiente de produção sem expor seus valores.
- [ ] Deixar explícito ao comprador que a conta é criada/recuperada por e-mail, sem senha, e que o e-mail precisa ser o mesmo do checkout.
- [x] Deixar explícito no login que o cliente deve usar o e-mail do checkout e que o acesso é por link sem senha.
- [x] Implementar a área **Minha conta**, listando os acessos associados ao e-mail verificado e permitindo criar/recuperar o link de compras ativas.
- [x] Usar `/conta` como retorno seguro quando o magic link for aberto sem o `sessionStorage` da aba de origem ou em outro dispositivo.
- [ ] Publicar e verificar o retorno pós-checkout e a área de conta no domínio de produção.
- [ ] Verificar concessão após aprovação e revogação após reembolso/chargeback com eventos assinados e dados de teste correspondentes a uma compra pendente.
- [ ] Executar o evento de teste da Cakto depois de cadastrar o webhook. O evento fixo testa entrega/assinatura; não deve ser tratado como compra paga.
- [x] Enviar as alterações para branches do GitHub e abrir PRs; CI passou no backend e frontend.
- [ ] Revisar e integrar o PR do backend; o deploy em `main` roda migrations e importa as novas versões do catálogo.
- [ ] Depois da API estar no ar, retirar o PR do frontend de draft, revisar e integrar a interface.
- [x] Habilitar `PRODUCTION_DEPLOY_ENABLED=true` no ambiente `production` do backend para que um merge aprovado em `main` dispare o deploy isolado.
- [ ] Confirmar em produção API, checkout, e-mail de login e teste assinado do webhook antes de considerar o fluxo liberado.

### Demonstração grátis compartilhável

- [x] Definir acesso de teste limitado a uma mensagem por categoria e navegador: Relacionamento, Cobranças, Ofertas e Serviços.
- [x] Persistir os links no backend por sete dias e usar uma rota pública independente do `localStorage`.
- [x] Marcar a rota pública como demonstração e separar seus dados/tabela da publicação premium.
- [x] Manter a licença premium protegida; a demonstração não concede acesso e não torna `/p/:slug` válido.
- [x] Revalidar os dados do modelo e as regras financeiras do domínio ao criar e abrir a demonstração.
- [x] Incluir teste com conteúdo personalizado diferente dos exemplos e teste de recusa quando a confirmação financeira não satisfaz o domínio.
- [ ] Verificar a abertura de um link de demonstração em outro dispositivo depois da publicação.

### Preços e limites desta tarefa

- [x] Preservar a oferta atual de pagamento único por R$ 67,00.
- [ ] A oferta anual continua inexistente. Não criar ou alterar preços neste trabalho; exige decisão comercial separada.

## Critérios de conclusão

1. Webhook de produção cadastrado e entrega confirmada no histórico da Cakto.
2. Em produção, um cliente entra com o e-mail usado no checkout e encontra a compra em **Minha conta**.
3. Em produção, uma aprovação concede publicação; reembolso/chargeback revoga o acesso.
4. Em produção, um visitante testa uma mensagem de cada categoria, abre o link em outro dispositivo e não recebe licença premium.
5. O retorno e as instruções de acesso funcionam sem depender da aba original.
6. Nenhum preço foi alterado e nenhuma compra real de teste foi feita.

## Validação local da implementação

- [x] Backend: 64 testes unitários, 49 de integração e 1 E2E passaram.
- [x] Frontend: 50 testes passaram; lint e typecheck passaram.
- [x] Backend: lint e build TypeScript passaram.
- [ ] Verificações na VPS e no domínio após merge/deploy ainda pendentes.

## Próximo passo externo aguardando autorização

O preview atual cria o webhook **Cadernô Express - Produção** inicialmente com status `disabled`, associado somente ao produto UUID acima, no endpoint do backend e com os seis eventos listados. Ele fica sem enviar eventos até ativarmos depois que o segredo estiver no GitHub e a versão do backend estiver publicada. A operação é em produção e não tem idempotência confirmada; se a resposta for ambígua, consultar a lista antes de tentar novamente.

O preview anterior para `emailAccessLink=https://caderno-express.otimizanegocio.com/entrar` também não foi executado. Atualizar esse link fica para depois que a área Minha conta estiver publicada e conferida, para não encaminhar compradores antes do backend estar pronto. A Cakto exige aprovação humana do preview exato antes de cada escrita com `confirm=true`.
