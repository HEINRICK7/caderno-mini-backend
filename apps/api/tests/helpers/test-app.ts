import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type { FastifyInstance } from 'fastify';

import {
  createApplicationServices,
  createAnalyticsServices,
  createCommerceServices,
  createIdentityServices,
  createPublishingServices,
} from '../../src/bootstrap/services.js';
import { buildApp } from '../../src/bootstrap/app.js';
import { createDatabase } from '../../src/infrastructure/database/connection.js';
import type { CommerceServices } from '../../src/bootstrap/services.js';
import { migrateDatabase } from '../../src/infrastructure/database/migrate.js';
import type { MagicLinkEmail } from '../../src/application/ports/email-sender.js';
import { SharpPngRenderer } from '../../src/infrastructure/rendering/sharp-png-renderer.js';

export async function createTestApp(
  databaseFile = ':memory:',
  options: { authCookieSecure?: boolean } = {},
): Promise<{
  app: FastifyInstance;
  database: ReturnType<typeof createDatabase>;
  sentMagicLinks: MagicLinkEmail[];
  commerceServices: CommerceServices;
}> {
  const database = createDatabase(databaseFile);
  migrateDatabase(
    database.sqlite,
    resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'),
  );

  const sentMagicLinks: MagicLinkEmail[] = [];
  const commerceServices = createCommerceServices(database.db, {
    checkoutUrl: 'https://pay.cakto.com.br/test-offer',
    expectedProductId: 'test-product-id',
    webhookSecret: 'test-webhook-secret-with-at-least-16-chars',
    idGenerator: randomUUID,
    callbackGenerator: randomUUID,
    clock: () => new Date(),
  });
  const app = buildApp({
    logger: false,
    services: createApplicationServices(database.db, {
      idGenerator: randomUUID,
      clock: () => new Date(),
    }),
    commerceServices,
    publishingServices: createPublishingServices(database.db, new SharpPngRenderer(), {
      clock: () => new Date(),
    }),
    analyticsServices: createAnalyticsServices(database.db, { clock: () => new Date() }),
    analyticsReadToken: 'test-analytics-read-token-with-at-least-32-chars',
    authPublicAppUrl: 'http://localhost:3000',
    identityServices: createIdentityServices(database.db, {
      emailSender: {
        sendMagicLink: async (message) => {
          sentMagicLinks.push(message);
        },
      },
      publicAppUrl: 'http://localhost:3000',
      generateToken: randomUUID,
      generateUserId: randomUUID,
      generateSessionId: randomUUID,
      clock: () => new Date(),
    }),
    ...(options.authCookieSecure === undefined ? {} : { authCookieSecure: options.authCookieSecure }),
    healthCheck: () => database.sqlite.prepare('select 1').get(),
  });
  await app.ready();

  return { app, database, sentMagicLinks, commerceServices };
}
