import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import { demoPublications } from '../../src/infrastructure/database/schema.js';

describe('demonstrações públicas', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('gera um link compartilhável temporário sem conceder licença premium e limita um link por categoria', async () => {
    const { app, database } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    const definition = {
      catalog: { segment: 'both', category: 'Boas-vindas', homeCategory: 'relacionamento' },
      fields: [{ id: 'message', type: 'text', required: true }],
    };
    insertTemplate(database.db, { definition });
    insertTemplate(database.db, {
      id: 'relacionamento-2',
      name: 'Outro modelo de relacionamento',
      definition,
    });

    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: { message: 'Texto personalizado para a demonstração.' } },
    });
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-publications',
      payload: { draftId: draft.json().data.id },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json().data).toMatchObject({
      publicPath: expect.stringMatching(/^\/d\/[A-Za-z0-9_-]{43}$/),
      publicUrl: expect.stringContaining('/d/'),
      category: 'relacionamento',
      created: true,
    });
    const firstSlug = first.json().data.slug as string;
    const cookie = String(first.headers['set-cookie']).split(';')[0];

    const publicDemo = await app.inject({ method: 'GET', url: `/api/v1/demo-publications/${firstSlug}` });
    expect(publicDemo.statusCode).toBe(200);
    expect(publicDemo.json().data.data).toEqual({ message: 'Texto personalizado para a demonstração.' });
    expect((await app.inject({ method: 'GET', url: `/p/${firstSlug}` })).statusCode).toBe(404);

    const secondDraft = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'relacionamento-2', data: { message: 'Outra mensagem.' } },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-publications',
      headers: { cookie },
      payload: { draftId: secondDraft.json().data.id },
    });

    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({ slug: firstSlug, created: false, category: 'relacionamento' });
    expect(database.db.select().from(demoPublications).all()).toHaveLength(1);
  });

  it('aplica as regras financeiras do domínio também à demonstração', async () => {
    const { app, database } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    insertTemplate(database.db, {
      id: 'pagamento-confirmado',
      definition: {
        catalog: { segment: 'both', category: 'Cobrança', homeCategory: 'cobrancas' },
        fields: [{ id: 'state', type: 'text' }],
        card: { illustration: 'payment-check', heading: 'Pagamento confirmado', financial: { stateFieldId: 'state', expectedState: 'confirmed' }, footer: 'none' },
      },
    });
    const draft = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'pagamento-confirmado', data: { state: 'pending' } },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo-publications',
      payload: { draftId: draft.json().data.id },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('TEMPLATE_FINANCIAL_STATE_UNAVAILABLE');
    expect(database.db.select().from(demoPublications).all()).toHaveLength(0);
  });
});
