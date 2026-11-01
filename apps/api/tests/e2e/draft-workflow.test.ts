import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { JsonObject } from '../../src/domain/shared/json-value.js';
import type { createDatabase } from '../../src/infrastructure/database/connection.js';
import type { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import { createTestApp as buildTestApp } from '../helpers/test-app.js';

type OfficialTemplate = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  definition: JsonObject;
  isActive: boolean;
};

const officialCatalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'catalog/templates.json'), 'utf8'),
) as OfficialTemplate[];

describe('anonymous official-template HTTP workflow', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'] | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    await app?.close();
    database?.close();
    app = undefined;
    database = undefined;
  });

  it('lists, validates, creates, updates, and previews the official purchase template over HTTP', async () => {
    ({ app, database } = await buildTestApp());
    const template = officialCatalog.find((candidate) => candidate.id === 'agradecimento-compra');
    expect(template).toBeDefined();
    if (!template) throw new Error('O modelo oficial agradecimento-compra precisa existir no catálogo.');

    insertTemplate(database.db, template);

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const templates = await fetch(`${address}/api/v1/templates`);
    expect(templates.status).toBe(200);
    const catalogResponse = await templates.json();
    expect(catalogResponse.data).toHaveLength(1);
    expect(catalogResponse.data[0]).toMatchObject({ id: template.id, definition: template.definition });

    const messageData = {
      recipientName: 'Maria',
      businessName: 'Cadernô Express',
      message: 'Sua compra foi registrada com sucesso. Esperamos que aproveite seu produto.',
      productName: 'Conjunto de mesa',
      purchaseAmount: 350,
      purchaseLink: 'https://loja.example/pedido/123',
    };
    const validationResponse = await fetch(`${address}/api/v1/templates/${template.id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: messageData }),
    });
    expect(validationResponse.status).toBe(200);

    const invalidValidation = await fetch(`${address}/api/v1/templates/${template.id}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { ...messageData, unapprovedField: 'não permitido' } }),
    });
    expect(invalidValidation.status).toBe(422);

    const createResponse = await fetch(`${address}/api/v1/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: template.id, data: messageData }),
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
      templateId: template.id,
      templateVersion: template.version,
      data: { ...messageData, message: 'Depois' },
    });

    const previewResponse = await fetch(`${address}/api/v1/drafts/${created.id}/preview.png`);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get('content-type')).toContain('image/png');
  });
});
