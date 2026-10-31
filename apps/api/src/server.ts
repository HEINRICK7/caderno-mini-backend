import { resolve } from 'node:path';

import { buildApp } from './bootstrap/app.js';
import { loadConfig } from './bootstrap/config.js';
import { createApplicationServices } from './bootstrap/services.js';
import { createDatabase } from './infrastructure/database/connection.js';
import { migrateDatabase } from './infrastructure/database/migrate.js';

const config = loadConfig();
const database = createDatabase(config.databaseFile);
migrateDatabase(
  database.sqlite,
  resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'),
);
const app = buildApp({
  logger: { level: config.logLevel },
  services: createApplicationServices(database.db),
  healthCheck: () => database.sqlite.prepare('select 1').get(),
});

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'Falha ao iniciar a API');
  await app.close();
  database.close();
  process.exitCode = 1;
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Encerrando a API');
  await app.close();
  database.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
