import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import type { createDatabase } from '../../src/infrastructure/database/connection.js';

describe('SQLite draft persistence', () => {
  let app: FastifyInstance;
  let database: ReturnType<typeof createDatabase>;
  let directory: string;
  let databaseFile: string;
  let draftId: string;

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'caderno-mini-'));
    databaseFile = join(directory, 'drafts.sqlite');
    ({ app, database } = await createTestApp(databaseFile));
    insertTemplate(database.db);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: { message: 'persistir' } },
    });
    expect(response.statusCode).toBe(201);
    draftId = response.json().data.id;

    await app.close();
    database.close();
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('recovers the draft after the connection is reopened', async () => {
    ({ app, database } = await createTestApp(databaseFile));

    const response = await app.inject({ method: 'GET', url: `/api/v1/drafts/${draftId}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: draftId,
      data: { message: 'persistir' },
    });

    await app.close();
    database.close();
  });
});
