import { resolve } from 'node:path';

import { buildApp } from './bootstrap/app.js';
import { loadConfig } from './bootstrap/config.js';
import {
  createApplicationServices,
  createAnalyticsServices,
  createCommerceServices,
  createIdentityServices,
  createImageServices,
  createPreviewServices,
  createPublishingServices,
} from './bootstrap/services.js';
import { createDatabase } from './infrastructure/database/connection.js';
import { NodemailerEmailSender } from './infrastructure/email/nodemailer-email-sender.js';
import { SharpPngRenderer } from './infrastructure/rendering/sharp-png-renderer.js';
import { migrateDatabase } from './infrastructure/database/migrate.js';
import { MinioImageStorage } from './infrastructure/images/minio-image-storage.js';

const config = loadConfig();
const database = createDatabase(config.databaseFile);
migrateDatabase(
  database.sqlite,
  resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'),
);
const commerceServices = createCommerceServices(database.db, {
  ...(config.caktoCheckoutUrl ? { checkoutUrl: config.caktoCheckoutUrl } : {}),
  ...(config.caktoProductId ? { expectedProductId: config.caktoProductId } : {}),
  ...(config.caktoWebhookSecret ? { webhookSecret: config.caktoWebhookSecret } : {}),
});
const imageStorage = new MinioImageStorage(config.imageStorage);
const imageServices = createImageServices(imageStorage);
const renderer = new SharpPngRenderer(imageStorage);
const app = buildApp({
  logger: { level: config.logLevel },
  services: createApplicationServices(database.db),
  commerceServices,
  imageServices,
  previewServices: createPreviewServices(database.db, renderer),
  publishingServices: createPublishingServices(database.db, renderer),
  analyticsServices: createAnalyticsServices(database.db),
  ...(config.analyticsReadToken ? { analyticsReadToken: config.analyticsReadToken } : {}),
  publicApiUrl: config.publicApiUrl,
  publicAppUrl: config.publicAppUrl,
  authPublicAppUrl: config.authPublicAppUrl,
  identityServices: createIdentityServices(database.db, {
    emailSender: new NodemailerEmailSender({
      ...(config.smtpUrl ? { smtpUrl: config.smtpUrl } : {}),
      ...(config.emailFrom ? { from: config.emailFrom } : {}),
    }),
    publicAppUrl: config.authPublicAppUrl,
  }),
  authCookieSecure: config.nodeEnv === 'production',
  trustedProxyAddresses: config.trustedProxyAddresses,
  healthCheck: () => database.sqlite.prepare('select 1').get(),
});
let webhookWorker: NodeJS.Timeout | undefined;
app.addHook('onClose', () => {
  if (webhookWorker) {
    clearInterval(webhookWorker);
  }
});

try {
  await app.listen({ host: config.host, port: config.port });
  const runWebhookWorker = () => {
    try {
      commerceServices.processCaktoInboxBatch();
    } catch (error) {
      app.log.error(
        { errorType: error instanceof Error ? error.name : 'UnknownError' },
        'Falha ao processar eventos de pagamento',
      );
    }
  };
  runWebhookWorker();
  webhookWorker = setInterval(runWebhookWorker, 1_000);
  webhookWorker.unref();
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
