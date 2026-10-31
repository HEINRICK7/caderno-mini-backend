# ADR 0004 — Identidade por magic link e sessões de servidor

- **Status:** Aceita
- **Data:** 2026-10-31

## Contexto

O visitante pode criar rascunhos sem cadastro, mas precisa de uma identidade para recuperar criações em outro dispositivo, reclamar o rascunho depois de uma compra e administrar publicações. O fluxo deve evitar senhas e não pode fazer o cliente declarar pagamento ou propriedade.

## Decisão

- A autenticação começa por e-mail com token aleatório de 256 bits, uso único e validade de 15 minutos. O banco guarda apenas o hash SHA-256 do token.
- A solicitação cria ou reutiliza a identidade somente após um token válido. E-mails são removidos de espaços externos e normalizados em minúsculas.
- `POST /api/v1/auth/magic-link` responde sempre com o mesmo `202`, exista ou não uma conta. Limites por IP e por e-mail reduzem enumeração e abuso de envio.
- O envio ocorre por uma porta `EmailSender`; a implementação de produção usa SMTP configurado por ambiente. Tokens e links não entram em logs.
- `POST /api/v1/auth/verify` consome o token uma única vez, cria/recupera o usuário e abre uma sessão em uma transação SQLite.
- Sessões usam um token aleatório independente, guardado apenas como hash no banco, com validade fixa de 30 dias, revogação explícita e cookie `HttpOnly`, `Path=/`, `SameSite=Lax`; `Secure` é obrigatório fora de desenvolvimento local.
- O backend nunca aceita ID de usuário ou estado de compra enviado pelo navegador para escolher o proprietário ou conceder acesso.
- Em mutações iniciadas por navegadores, a origem deve corresponder à origem configurada em `AUTH_PUBLIC_APP_URL`. A checagem cobre rotas de identidade e mutações que enviem o cookie de sessão. Clientes servidor-a-servidor sem cabeçalhos de navegador continuam aceitos; não se deve habilitar CORS para origens arbitrárias.

## Consequências

- O frontend não precisa guardar segredo de sessão em `localStorage`.
- Tokens podem ser enviados uma única vez em link de e-mail; a aplicação deve evitar incluir o token em logs, analytics ou cabeçalho `Referer` e limpar a URL depois da verificação.
- Requisições de navegador com `Origin` diferente ou `Sec-Fetch-Site` sem origem permitida recebem `403 CSRF_ORIGIN_INVALID` antes da execução da rota.
- A entrega de e-mail depende de SMTP e precisa de credenciais válidas nos ambientes configurados. Testes usam uma implementação falsa e não enviam mensagens reais.
- Associar um rascunho a uma conta é uma operação separada, idempotente e verificada; autenticar-se não concede licença.

## Alternativas consideradas

- **Senha e recuperação:** rejeitada para o MVP por aumentar suporte e superfície de ataque.
- **JWT autossuficiente com longa validade:** rejeitada porque dificulta revogação imediata e rotação de sessão.
- **Sessão em `localStorage`:** rejeitada por expor a credencial a JavaScript executado por XSS.
