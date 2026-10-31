import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { createApplicationServices } from '../../src/bootstrap/services.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { createDatabase } from '../../src/infrastructure/database/connection.js';
import { migrateDatabase } from '../../src/infrastructure/database/migrate.js';

export async function createTestApp(databaseFile = ':memory:'): Promise<{
  app: FastifyInstance;
  database: ReturnType<typeof createDatabase>;
}> {
  const database = createDatabase(databaseFile);
  migrateDatabase(
    database.sqlite,
    resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'),
  );

  const app = buildApp({
    logger: false,
    services: createApplicationServices(database.db, {
      idGenerator: randomUUID,
      clock: () => new Date(),
    }),
    healthCheck: () => database.sqlite.prepare('select 1').get(),
  });
  await app.ready();

  return { app, database };
}
