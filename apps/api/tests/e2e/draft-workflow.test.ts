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
    insertTemplate(database.db);

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const templates = await fetch(`${address}/api/v1/templates`);
    expect(templates.status).toBe(200);
    expect((await templates.json()).data).toHaveLength(1);

    const createResponse = await fetch(`${address}/api/v1/drafts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'mensagem-exemplo',
        data: { message: 'Antes' },
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()).data;

    const updateResponse = await fetch(`${address}/api/v1/drafts/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { message: 'Depois' } }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()).data.data).toEqual({ message: 'Depois' });

    const readResponse = await fetch(`${address}/api/v1/drafts/${created.id}`);
    expect(readResponse.status).toBe(200);
    expect((await readResponse.json()).data).toMatchObject({
      id: created.id,
      templateVersion: 1,
      data: { message: 'Depois' },
    });
  });
});
