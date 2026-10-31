import { resolve } from 'node:path';

import { loadConfig } from './bootstrap/config.js';
import { createDatabase } from './infrastructure/database/connection.js';
import { migrateDatabase } from './infrastructure/database/migrate.js';

const config = loadConfig();
const database = createDatabase(config.databaseFile);

try {
  migrateDatabase(
    database.sqlite,
    resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'),
  );
} finally {
  database.close();
}
