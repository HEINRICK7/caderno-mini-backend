import { loadConfig } from '../../bootstrap/config.js';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { templates } from './schema.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de exemplo é exclusivo de desenvolvimento.');
}

const config = loadConfig();
const database = createDatabase(config.databaseFile);

try {
  migrateDatabase(database.sqlite, 'apps/api/src/infrastructure/database/migrations');
  const existing = database.db
    .select()
    .from(templates)
    .where(and(eq(templates.id, 'mensagem-exemplo'), eq(templates.version, 1)))
    .get();

  if (!existing) {
    database.db
      .insert(templates)
      .values({
        id: 'mensagem-exemplo',
        version: 1,
        name: 'Modelo de exemplo (desenvolvimento)',
        description: 'Fixture local; não representa o catálogo oficial.',
        definition: { fields: [{ id: 'message', type: 'text' }] },
        isActive: true,
        createdAt: new Date(),
      })
      .run();
  }
} finally {
  database.close();
}
