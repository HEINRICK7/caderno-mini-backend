import { afterEach, describe, expect, it } from 'vitest';

import type { createDatabase } from '../../src/infrastructure/database/connection.js';
import type { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import { createTestApp as buildTestApp } from '../helpers/test-app.js';

describe('anonymous draft HTTP workflow', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'] | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    await app?.close();
    database?.close();
    app = undefined;
    database = undefined;
  });

  it('creates, updates, and retrieves a draft over HTTP', async () => {
    ({ app, database } = await buildTestApp());
    insertTemplate(database.db, {
      id: 'obrigado-compra',
      name: 'Agradecimento pela compra',
      description: 'Valoriza o cliente após a venda.',
      definition: {
        fields: [
          { id: 'recipientName', type: 'text', required: true, maxLength: 60 },
          { id: 'businessName', type: 'text', required: true, maxLength: 80 },
          { id: 'message', type: 'textarea', required: true, maxLength: 300 },
          { id: 'productName', type: 'text', required: true, maxLength: 120 },
          { id: 'purchaseAmount', type: 'number', format: 'currency', required: true },
        ],
        catalog: { segment: 'product', category: 'Agradecimento' },
        visual: {
          layout: 'centered',
          background: '#e5f0ff',
          surface: '#ffffff',
          accent: '#2563eb',
          heading: '#10264f',
          text: '#385176',
          muted: '#687895',
          headingFont: 'rounded',
          bodyFont: 'sans',
          frame: 'none',
        },
        card: {
          illustration: 'shopping-bag-heart',
          heading: 'Obrigado, {{recipientName}}! 💙',
          message: '{{message}}',
          details: [
            { label: 'Produto', value: '{{productName}}', icon: 'package' },
            { label: 'Valor', value: '{{purchaseAmount}}', icon: 'credit-card', format: 'currency' },
          ],
          action: { label: 'Ver detalhes da compra' },
          footer: 'none',
        },
      },
    });

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const templates = await fetch(`${address}/api/v1/templates`);
    expect(templates.status).toBe(200);
    expect((await templates.json()).data).toHaveLength(1);

    const messageData = {
      recipientName: 'Maria',
      businessName: 'Cadernô Express',
      message: 'Sua compra foi registrada com sucesso. Esperamos que aproveite seu produto.',
      productName: 'Conjunto de mesa',
      purchaseAmount: 350,
    };
    const validationResponse = await fetch(`${address}/api/v1/templates/obrigado-compra/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: messageData }),
    });
    expect(validationResponse.status).toBe(200);

    const createResponse = await fetch(`${address}/api/v1/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'obrigado-compra',
        data: messageData,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()).data;

    const updateResponse = await fetch(`${address}/api/v1/drafts/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { ...messageData, message: 'Depois' } }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).data.data).toEqual({ ...messageData, message: 'Depois' });

    const readResponse = await fetch(`${address}/api/v1/drafts/${created.id}`);
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()).data).toMatchObject({
      id: created.id,
      templateId: 'obrigado-compra',
      templateVersion: 1,
      data: { ...messageData, message: 'Depois' },
    });

    const previewResponse = await fetch(`${address}/api/v1/drafts/${created.id}/preview.png`);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get('content-type')).toContain('image/png');
  });
});
