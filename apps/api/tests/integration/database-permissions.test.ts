import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/infrastructure/database/connection.js';

describe('SQLite file permissions', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it('keeps the database and WAL files private to the service user', () => {
    directory = mkdtempSync(join(tmpdir(), 'caderno-mini-private-'));
    const databaseFile = join(directory, 'nested', 'private.sqlite');
    const database = createDatabase(databaseFile);

    try {
      database.sqlite.exec('create table private_data (value text); insert into private_data values (\'draft\')');
      expect(statSync(join(directory, 'nested')).mode & 0o777).toBe(0o700);

      for (const suffix of ['', '-wal', '-shm']) {
        expect(statSync(`${databaseFile}${suffix}`).mode & 0o777).toBe(0o600);
      }
    } finally {
      database.close();
    }
  });
});
