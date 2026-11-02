import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseConnection = {
  db: AppDatabase;
  sqlite: Database.Database;
  close: () => void;
};

export function createDatabase(filePath = ':memory:'): DatabaseConnection {
  const resolvedFile = filePath === ':memory:' ? filePath : resolve(filePath);

  if (resolvedFile !== ':memory:') {
    mkdirSync(dirname(resolvedFile), { recursive: true, mode: 0o700 });
  }

  const sqlite = new Database(resolvedFile);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('journal_mode = WAL');

  if (resolvedFile !== ':memory:') {
    for (const suffix of ['', '-wal', '-shm']) {
      const databaseFile = `${resolvedFile}${suffix}`;
      if (existsSync(databaseFile)) {
        chmodSync(databaseFile, 0o600);
      }
    }
  }

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    close: () => sqlite.close(),
  };
}
