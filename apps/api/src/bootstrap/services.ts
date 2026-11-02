import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '../infrastructure/database/connection.js';
import { SqliteDraftRepository } from '../infrastructure/database/repositories/sqlite-draft-repository.js';
import { SqliteTemplateRepository } from '../infrastructure/database/repositories/sqlite-template-repository.js';
import { createDraft } from '../application/use-cases/create-draft.js';
import { getDraft } from '../application/use-cases/get-draft.js';
import { listTemplates } from '../application/use-cases/list-templates.js';
import { getTemplate } from '../application/use-cases/get-template.js';
import { validateActiveTemplateInput } from '../application/use-cases/validate-template-input.js';
import { updateDraft } from '../application/use-cases/update-draft.js';
import { previewDraft, type PreviewDraftDependencies } from '../application/use-cases/preview-draft.js';
import { createCheckout } from '../application/use-cases/create-checkout.js';
import { getPurchaseStatus, listUserAccess, userHasActiveGrantForDraft } from '../application/use-cases/get-purchase-status.js';
import { CheckoutNotConfiguredError, WebhookNotConfiguredError } from '../application/errors.js';
import { persistCaktoEvents, processCaktoInboxBatch } from '../application/use-cases/cakto-webhooks.js';
import {
  getSession,
  requestMagicLink,
  revokeSession,
  verifyMagicLink,
  type IdentityDependencies,
} from '../application/use-cases/identity.js';
import type { EmailSender } from '../application/ports/email-sender.js';
import { SqliteIdentityRepository } from '../infrastructure/database/repositories/sqlite-identity-repository.js';
import { SqlitePurchaseRepository } from '../infrastructure/database/repositories/sqlite-purchase-repository.js';
import { SqliteWebhookInboxRepository } from '../infrastructure/database/repositories/sqlite-webhook-inbox-repository.js';
import { CaktoHostedCheckoutLink } from '../infrastructure/payments/cakto/hosted-checkout-link.js';
import { parseCaktoWebhook, type CaktoWebhookHeaders } from '../infrastructure/payments/cakto/webhook.js';
import { SqlitePublicationRepository } from '../infrastructure/database/repositories/sqlite-publication-repository.js';
import {
  exportMessage,
  getPublicMessage,
  publishMessage,
  renderPublicMessagePng,
  unpublishMessage,
  type PublicationDependencies,
} from '../application/use-cases/publication.js';
import type { PngRenderer } from '../application/ports/png-renderer.js';
import type { ImageStorage } from '../application/ports/image-storage.js';
import { uploadImage, getImage } from '../application/use-cases/images.js';
import { SqliteAnalyticsRepository } from '../infrastructure/database/repositories/sqlite-analytics-repository.js';
import {
  getAnalyticsSummary,
  recordServerEvent,
  trackClientEvent,
} from '../application/use-cases/analytics.js';
import { createDemoPublication, getDemoPublication } from '../application/use-cases/demo-publications.js';
import { SqliteDemoPublicationRepository } from '../infrastructure/database/repositories/sqlite-demo-publication-repository.js';
import { SqliteAdminRepository } from '../infrastructure/database/repositories/sqlite-admin-repository.js';

export type ApplicationServices = ReturnType<typeof createApplicationServices>;

export function createApplicationServices(
  db: AppDatabase,
  options: { idGenerator?: () => string; clock?: () => Date } = {},
) {
  const templates = new SqliteTemplateRepository(db);
  const drafts = new SqliteDraftRepository(db);
  const idGenerator = options.idGenerator ?? randomUUID;
  const clock = options.clock ?? (() => new Date());

  return {
    listTemplates: () => listTemplates({ templates }),
    getTemplate: (input: Parameters<typeof getTemplate>[0]) => getTemplate(input, { templates }),
    validateTemplateInput: (input: Parameters<typeof validateActiveTemplateInput>[0]) =>
      validateActiveTemplateInput(input, { templates }),
    createDraft: (input: Parameters<typeof createDraft>[0]) =>
      createDraft(input, { templates, drafts, idGenerator, clock }),
    getDraft: (input: Parameters<typeof getDraft>[0]) => getDraft(input, { drafts }),
    updateDraft: (input: Parameters<typeof updateDraft>[0]) =>
      updateDraft(input, { drafts, templates, clock }),
  };
}

export type PreviewServices = ReturnType<typeof createPreviewServices>;

export type ImageServices = ReturnType<typeof createImageServices>;

export function createImageServices(
  images: ImageStorage,
  options: { idGenerator?: () => string } = {},
) {
  const generateId = options.idGenerator ?? randomUUID;
  return {
    upload: (input: { dataUrl: string }) => uploadImage(input, { images, generateId }),
    get: (input: { id: string }) => getImage(input, { images }),
  };
}

export function createPreviewServices(db: AppDatabase, renderer: PngRenderer) {
  const dependencies: PreviewDraftDependencies = {
    drafts: new SqliteDraftRepository(db),
    templates: new SqliteTemplateRepository(db),
    renderer,
  };

  return {
    previewDraft: (input: Parameters<typeof previewDraft>[0]) => previewDraft(input, dependencies),
  };
}

export type IdentityServices = ReturnType<typeof createIdentityServices>;

export function createIdentityServices(
  db: AppDatabase,
  options: Omit<IdentityDependencies, 'identities' | 'emailSender'> & { emailSender: EmailSender },
) {
  const dependencies: IdentityDependencies = {
    ...options,
    identities: new SqliteIdentityRepository(db),
  };

  return {
    requestMagicLink: (input: { email: string }) => requestMagicLink(input, dependencies),
    verifyMagicLink: (input: { token: string }) => verifyMagicLink(input, dependencies),
    getSession: (input: { token: string }) => getSession(input, dependencies),
    revokeSession: (input: { token: string }) => revokeSession(input, dependencies),
  };
}

export type AdminServices = ReturnType<typeof createAdminServices>;

export function createAdminServices(
  db: AppDatabase,
  options: { idGenerator?: () => string; clock?: () => Date } = {},
) {
  const admin = new SqliteAdminRepository(db);
  const idGenerator = options.idGenerator ?? randomUUID;
  const clock = options.clock ?? (() => new Date());
  return {
    listUsers: (input: { query?: string; limit: number; offset: number }) =>
      admin.listUsers({ ...input, now: clock() }),
    getUser: (input: { userId: string }) => admin.getUser({ ...input, now: clock() }),
    setUserStatus: (input: { userId: string; actorUserId: string; status: 'active' | 'suspended' }) =>
      admin.setUserStatus({ ...input, now: clock(), id: idGenerator() }),
  };
}

export type CommerceServices = ReturnType<typeof createCommerceServices>;

export function createCommerceServices(
  db: AppDatabase,
  options: {
    checkoutUrl?: string;
    expectedProductId?: string;
    webhookSecret?: string;
    idGenerator?: () => string;
    callbackGenerator?: () => string;
    clock?: () => Date;
  } = {},
) {
  const drafts = new SqliteDraftRepository(db);
  const purchases = new SqlitePurchaseRepository(db);
  const inbox = new SqliteWebhookInboxRepository(db);
  const analytics = new SqliteAnalyticsRepository(db);
  const checkoutLinks = options.checkoutUrl
    ? new CaktoHostedCheckoutLink(options.checkoutUrl)
    : undefined;
  const idGenerator = options.idGenerator ?? randomUUID;
  const callbackGenerator = options.callbackGenerator;
  const clock = options.clock ?? (() => new Date());

  return {
    createCheckout: (input: { draftId: string; userId?: string }) => {
      if (!checkoutLinks || !options.expectedProductId) {
        throw new CheckoutNotConfiguredError();
      }
      return createCheckout(input, {
        drafts,
        purchases,
        checkoutLinks,
        generateId: idGenerator,
        ...(callbackGenerator ? { generateCallback: callbackGenerator } : {}),
        clock,
      });
    },
    getPurchaseStatus: (input: Parameters<typeof getPurchaseStatus>[0]) =>
      getPurchaseStatus(input, { purchases }),
    listUserAccess: (input: Parameters<typeof listUserAccess>[0]) => listUserAccess(input, { purchases }),
    userHasActiveGrantForDraft: (input: Parameters<typeof userHasActiveGrantForDraft>[0]) =>
      userHasActiveGrantForDraft(input, { purchases }),
    acceptCaktoWebhook: (input: { rawBody: Buffer; headers: CaktoWebhookHeaders }) => {
      if (!options.webhookSecret) {
        throw new WebhookNotConfiguredError();
      }
      const now = clock();
      const events = parseCaktoWebhook(input.rawBody, input.headers, {
        secret: options.webhookSecret,
        now,
      });
      return persistCaktoEvents(events, {
        inbox,
        generateId: idGenerator,
        clock: () => now,
      });
    },
    processCaktoInboxBatch: (limit = 25) =>
      processCaktoInboxBatch(
        {
          inbox,
          purchases,
          analytics,
          ...(options.expectedProductId ? { expectedProductId: options.expectedProductId } : {}),
          generateId: idGenerator,
          clock,
        },
        limit,
      ),
  };
}

export type PublishingServices = ReturnType<typeof createPublishingServices>;

export function createPublishingServices(
  db: AppDatabase,
  renderer: PngRenderer,
  options: { idGenerator?: () => string; slugGenerator?: () => string; clock?: () => Date } = {},
) {
  const dependencies: PublicationDependencies = {
    drafts: new SqliteDraftRepository(db),
    publications: new SqlitePublicationRepository(db),
    purchases: new SqlitePurchaseRepository(db),
    templates: new SqliteTemplateRepository(db),
    renderer,
    ...(options.idGenerator ? { generateId: options.idGenerator } : {}),
    ...(options.slugGenerator ? { generateSlug: options.slugGenerator } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  };
  return {
    publish: (input: { draftId: string; userId: string }) => publishMessage(input, dependencies),
    unpublish: (input: { draftId: string; userId: string }) => unpublishMessage(input, dependencies),
    getPublicMessage: (input: { slug: string }) => getPublicMessage(input, dependencies),
    renderPublicMessagePng: (input: { slug: string }) => renderPublicMessagePng(input, dependencies),
    exportMessage: (input: { draftId: string; userId: string }) => exportMessage(input, dependencies),
  };
}

export type DemoServices = ReturnType<typeof createDemoServices>;

export function createDemoServices(
  db: AppDatabase,
  options: { slugGenerator?: () => string; clock?: () => Date } = {},
) {
  const demos = new SqliteDemoPublicationRepository(db);
  const drafts = new SqliteDraftRepository(db);
  const templates = new SqliteTemplateRepository(db);
  return {
    create: (input: Parameters<typeof createDemoPublication>[0]) =>
      createDemoPublication(input, {
        demos,
        drafts,
        templates,
        ...(options.slugGenerator ? { generateSlug: options.slugGenerator } : {}),
        ...(options.clock ? { clock: options.clock } : {}),
      }),
    get: (input: Parameters<typeof getDemoPublication>[0]) =>
      getDemoPublication(input, { demos, ...(options.clock ? { clock: options.clock } : {}) }),
  };
}

export type AnalyticsServices = ReturnType<typeof createAnalyticsServices>;

export function createAnalyticsServices(db: AppDatabase, options: { clock?: () => Date } = {}) {
  const analytics = new SqliteAnalyticsRepository(db);
  const drafts = new SqliteDraftRepository(db);
  const templates = new SqliteTemplateRepository(db);
  return {
    trackClientEvent: (input: Parameters<typeof trackClientEvent>[0]) =>
      trackClientEvent(input, { analytics, drafts, templates, ...(options.clock ? { clock: options.clock } : {}) }),
    recordServerEvent: (input: Parameters<typeof recordServerEvent>[0]) =>
      recordServerEvent(input, { analytics, ...(options.clock ? { clock: options.clock } : {}) }),
    getSummary: (input: Parameters<typeof getAnalyticsSummary>[0]) =>
      getAnalyticsSummary(input, { analytics }),
  };
}
