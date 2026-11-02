import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { backupDatabase } from '../../src/infrastructure/database/backup.js';
import type { createDatabase } from '../../src/infrastructure/database/connection.js';
import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';

describe('SQLite backup and restore', () => {
  it('restores a backed up database and keeps backup permissions private', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'caderno-mini-backup-'));
    const sourceFile = join(directory, 'source.sqlite');
    const backupFile = join(directory, 'backup', 'snapshot.sqlite');
    let app: Awaited<ReturnType<typeof createTestApp>>['app'] | undefined;
    let database: ReturnType<typeof createDatabase> | undefined;

    try {
      ({ app, database } = await createTestApp(sourceFile));
      insertTemplate(database.db);

      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/drafts',
        payload: { templateId: 'mensagem-exemplo', data: { message: 'recuperável' } },
      });
      expect(created.statusCode).toBe(201);

      await app.close();
      app = undefined;
      await backupDatabase(database.sqlite, backupFile);
      database.close();
      database = undefined;

      expect(statSync(backupFile).mode & 0o777).toBe(0o600);

      ({ app, database } = await createTestApp(backupFile));
      const restored = await app.inject({
        method: 'GET',
        url: `/api/v1/drafts/${created.json().data.id}`,
      });

      expect(restored.statusCode).toBe(200);
      expect(restored.json().data.data).toEqual({ message: 'recuperável' });
    } finally {
      await app?.close();
      database?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing backup destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'caderno-mini-backup-'));
    const databaseFile = join(directory, 'source.sqlite');
    const existingBackup = join(directory, 'backup.sqlite');
    const { app, database } = await createTestApp(databaseFile);

    try {
      await app.close();
      await backupDatabase(database.sqlite, existingBackup);
      await expect(backupDatabase(database.sqlite, existingBackup)).rejects.toThrow();
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
