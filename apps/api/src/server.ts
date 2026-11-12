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
  createDemoServices,
  createAdminServices,
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
  ...(config.abacatePay
    ? { abacatePay: { ...config.abacatePay, publicAppUrl: config.publicAppUrl } }
    : {}),
  ...(config.caktoPlans ? { legacyCaktoPlans: config.caktoPlans } : {}),
  ...(config.caktoProductId ? { expectedProductId: config.caktoProductId } : {}),
  ...(config.caktoWebhookSecret ? { webhookSecret: config.caktoWebhookSecret } : {}),
  ...(config.adminEmail ? { adminEmail: config.adminEmail } : {}),
});
const imageStorage = new MinioImageStorage(config.imageStorage);
const imageServices = createImageServices(imageStorage);
const renderer = new SharpPngRenderer(imageStorage);
const app = buildApp({
  logger: {
    level: config.logLevel,
    serializers: {
      req: (request) => ({
        method: request.method,
        // Fastify's default request serializer includes query parameters.
        // Log only the route template so webhookSecret and customer data stay out.
        url: request.routeOptions.url ?? '[unmatched]',
      }),
    },
  },
  services: createApplicationServices(database.db),
  commerceServices,
  adminServices: createAdminServices(database.db, config.adminEmail ? { adminEmail: config.adminEmail } : {}),
  ...(config.adminEmail ? { adminEmail: config.adminEmail } : {}),
  ...(config.adminPasswordHash ? { adminPasswordHash: config.adminPasswordHash } : {}),
  ...(config.adminSessionSecret ? { adminSessionSecret: config.adminSessionSecret } : {}),
  imageServices,
  previewServices: createPreviewServices(database.db, renderer),
  publishingServices: createPublishingServices(database.db, renderer),
  demoServices: createDemoServices(database.db),
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
      commerceServices.processPaymentInboxBatch();
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
