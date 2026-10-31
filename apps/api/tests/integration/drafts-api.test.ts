import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import type { createDatabase } from '../../src/infrastructure/database/connection.js';

describe('templates and anonymous drafts API', () => {
  let app: FastifyInstance;
  let database: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    ({ app, database } = await createTestApp());
  });

  afterEach(async () => {
    await app.close();
    database.close();
  });

  it('lists only active template versions', async () => {
    insertTemplate(database.db, { version: 1, isActive: false });
    insertTemplate(database.db, { version: 2, isActive: true });

    const response = await app.inject({ method: 'GET', url: '/api/v1/templates' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
    expect(response.json().data[0]).toMatchObject({ id: 'mensagem-exemplo', version: 2 });
  });

  it('creates, retrieves, and replaces draft data through the API', async () => {
    insertTemplate(database.db, { version: 2 });

    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: {
        templateId: 'mensagem-exemplo',
        data: { recipient: 'Lia', message: 'Feliz aniversário!' },
      },
    });
    const created = createdResponse.json().data;

    expect(createdResponse.statusCode).toBe(201);
    expect(createdResponse.headers['cache-control']).toBe('no-store');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created).toMatchObject({
      templateId: 'mensagem-exemplo',
      templateVersion: 2,
      data: { recipient: 'Lia', message: 'Feliz aniversário!' },
    });

    const retrievedResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${created.id}`,
    });
    expect(retrievedResponse.statusCode).toBe(200);
    expect(retrievedResponse.json().data).toEqual(created);

    const updatedResponse = await app.inject({
      method: 'PUT',
      url: `/api/v1/drafts/${created.id}`,
      payload: { data: { recipient: 'Lia', message: 'Com carinho!' } },
    });
    expect(updatedResponse.statusCode).toBe(200);
    expect(updatedResponse.json().data).toMatchObject({
      id: created.id,
      templateId: created.templateId,
      templateVersion: created.templateVersion,
      data: { recipient: 'Lia', message: 'Com carinho!' },
    });
    expect(updatedResponse.json().data.createdAt).toBe(created.createdAt);
  });

  it('returns stable not-found errors for missing templates and drafts', async () => {
    const missingTemplate = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'unknown-template', data: {} },
    });
    expect(missingTemplate.statusCode).toBe(404);
    expect(missingTemplate.json().error.code).toBe('TEMPLATE_NOT_FOUND');

    const missingDraft = await app.inject({
      method: 'GET',
      url: '/api/v1/drafts/00000000-0000-4000-8000-000000000001',
    });
    expect(missingDraft.statusCode).toBe(404);
    expect(missingDraft.json().error.code).toBe('DRAFT_NOT_FOUND');
  });

  it('rejects client supplied purchase or license state', async () => {
    insertTemplate(database.db);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: {}, licenseGranted: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });

  it('includes the template and draft routes in OpenAPI', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    const document = response.json();
    const paths = document.paths;

    expect(response.statusCode).toBe(200);
    expect(paths['/api/v1/templates'].get).toBeDefined();
    expect(paths['/api/v1/drafts'].post).toBeDefined();
    expect(paths['/api/v1/drafts/{id}'].get).toBeDefined();
    expect(paths['/api/v1/drafts/{id}'].put).toBeDefined();

    const references = JSON.stringify(paths).matchAll(/#\/components\/schemas\/([^"/]+)/g);
    for (const [, schemaName] of references) {
      expect(document.components.schemas[schemaName]).toBeDefined();
    }
  });
});
