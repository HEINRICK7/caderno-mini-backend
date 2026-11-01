# ADR 0005: imagens de template no MinIO

**Status:** Aceito
**Data:** 2026-10-31

## Contexto

Modelos permitem que a pessoa inclua logo da empresa e imagem do produto. Base64 não deve ser persistido nos rascunhos: ele aumenta o SQLite e os payloads, além de misturar conteúdo binário com os dados editáveis do modelo. A aplicação já tem um MinIO na VPS e precisa servir as imagens tanto no editor quanto em mensagens publicadas.

## Decisão

- O backend valida PNG, JPEG e WebP até 128 KiB, cria UUID aleatório e grava os bytes no bucket MinIO.
- Contratos de template e rascunho guardam somente o UUID do asset; o frontend nunca escreve direto no MinIO.
- `POST /api/v1/assets` recebe a imagem e responde com o UUID e caminho de conteúdo. `GET /api/v1/assets/:id/content` entrega a imagem com MIME validado, `nosniff` e cache imutável.
- URLs são acessíveis publicamente pelo identificador opaco para que cartões compartilhados carreguem as imagens sem sessão. As imagens desses campos devem ser próprias para compartilhamento.
- O bucket deve ser provisionado antes. A credencial da aplicação recebe somente leitura e gravação de objetos nesse bucket, sem criar bucket nem excluir objetos.
- Endpoint, porta, TLS, credenciais e bucket vêm de ambiente. Produção rejeita credenciais de desenvolvimento e exige TLS.

## Consequências

- Logo e imagem de produto podem ser reutilizadas em preview, exportação PNG e página pública sem duplicar conteúdo no rascunho.
- Imagens substituídas ou removidas podem deixar objetos sem referência; a remoção automatizada e a política de retenção ficam para um fluxo de limpeza posterior que considere rascunhos e publicações.
- Qualquer pessoa que conheça um UUID consegue acessar o respectivo arquivo; não enviar imagens confidenciais.
- Testes usam armazenamento em memória. O processo de produção usa o adaptador MinIO S3 configurado pela VPS.
