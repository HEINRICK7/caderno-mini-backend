import { buildApp } from './bootstrap/app.js';
import { loadConfig } from './bootstrap/config.js';

const config = loadConfig();
const app = buildApp({ logger: { level: config.logLevel } });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error({ err: error }, 'Falha ao iniciar a API');
  await app.close();
  process.exitCode = 1;
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Encerrando a API');
  await app.close();
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
