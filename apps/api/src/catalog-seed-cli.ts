import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import { loadConfig } from './bootstrap/config.js';
import { createDatabase } from './infrastructure/database/connection.js';
import { migrateDatabase } from './infrastructure/database/migrate.js';
import { seedTemplateCatalog } from './infrastructure/database/template-catalog-seeder.js';

const config = loadConfig();
const catalogPath = resolve(z.string().trim().min(1).parse(process.env.TEMPLATE_CATALOG_FILE));
const fileSize = statSync(catalogPath).size;
if (fileSize === 0 || fileSize > 5 * 1024 * 1024) {
  throw new Error('O arquivo do catálogo deve ter entre 1 byte e 5 MB.');
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
if (!Array.isArray(catalog) || catalog.length !== 16) {
  throw new Error('O catálogo de produção precisa conter exatamente os 16 modelos oficiais.');
}

const database = createDatabase(config.databaseFile);

try {
  migrateDatabase(database.sqlite, resolve('apps/api/src/infrastructure/database/migrations'));
  const result = seedTemplateCatalog(database.db, catalog);
  process.stdout.write(
    `Catálogo sincronizado: ${result.inserted} inseridos, ${result.statusChanged} status alterados, ${result.unchanged} inalterados.\n`,
  );
} finally {
  database.close();
}
