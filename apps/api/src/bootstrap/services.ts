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
import { CheckoutNotConfiguredError, CheckoutPlanRequiredError, WebhookNotConfiguredError } from '../application/errors.js';
import { persistPaymentEvents, processPaymentInboxBatch } from '../application/use-cases/cakto-webhooks.js';
import {
  getSession,
  getOrCreateAdminTestUser,
  requestMagicLink,
  revokeSession,
  verifyMagicLink,
  type IdentityDependencies,
} from '../application/use-cases/identity.js';
import type { EmailSender } from '../application/ports/email-sender.js';
import { SqliteIdentityRepository } from '../infrastructure/database/repositories/sqlite-identity-repository.js';
import { SqlitePurchaseRepository } from '../infrastructure/database/repositories/sqlite-purchase-repository.js';
import { SqliteWebhookInboxRepository } from '../infrastructure/database/repositories/sqlite-webhook-inbox-repository.js';
import type { AbacatePayConfig, CaktoPlanConfig } from './config.js';
import { CaktoHostedCheckoutLink } from '../infrastructure/payments/cakto/hosted-checkout-link.js';
import { parseCaktoWebhook, type CaktoWebhookHeaders } from '../infrastructure/payments/cakto/webhook.js';
import { AbacatePayHostedCheckoutLink } from '../infrastructure/payments/abacatepay/hosted-checkout-link.js';
import { parseAbacatePayWebhook, type AbacatePayWebhookHeaders } from '../infrastructure/payments/abacatepay/webhook.js';
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
import {
  archiveAdminTemplate,
  createAdminTemplateDraft,
  listAdminTemplates,
  publishAdminTemplateDraft,
  updateAdminTemplateDraft,
  validateAdminTemplateDefinition,
} from '../application/use-cases/admin-templates.js';

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
    getAdminTestUser: (input: { email: string }) => getOrCreateAdminTestUser(input, dependencies),
    revokeSession: (input: { token: string }) => revokeSession(input, dependencies),
  };
}

export type AdminServices = ReturnType<typeof createAdminServices>;

export function createAdminServices(
  db: AppDatabase,
  options: { idGenerator?: () => string; clock?: () => Date; adminEmail?: string } = {},
) {
  const admin = new SqliteAdminRepository(db, options.adminEmail);
  const templates = new SqliteTemplateRepository(db);
  const idGenerator = options.idGenerator ?? randomUUID;
  const clock = options.clock ?? (() => new Date());
  return {
    listTemplates: () => listAdminTemplates({ templates }),
    createTemplate: (input: Parameters<typeof createAdminTemplateDraft>[0]) =>
      createAdminTemplateDraft(input, { templates, clock }),
    updateTemplate: (input: Parameters<typeof updateAdminTemplateDraft>[0]) =>
      updateAdminTemplateDraft(input, { templates }),
    validateTemplate: (input: Parameters<typeof validateAdminTemplateDefinition>[0]) =>
      validateAdminTemplateDefinition(input),
    publishTemplate: (input: { id: string; version: number }) =>
      publishAdminTemplateDraft(input, { templates }),
    archiveTemplate: (input: { id: string }) => archiveAdminTemplate(input, { templates }),
    listUsers: (input: { query?: string; limit: number; offset: number }) =>
      admin.listUsers({ ...input, now: clock() }),
    getUser: (input: { userId: string }) => admin.getUser({ ...input, now: clock() }),
    setUserStatus: (input: { userId: string; actorEmail: string; status: 'active' | 'suspended' }) =>
      admin.setUserStatus({ ...input, now: clock(), id: idGenerator() }),
  };
}

export type CommerceServices = ReturnType<typeof createCommerceServices>;

export type CheckoutPlan = 'annual' | 'lifetime';

export function createCommerceServices(
  db: AppDatabase,
  options: {
    checkoutUrl?: string;
    expectedProductId?: string;
    webhookSecret?: string;
    adminEmail?: string;
    plans?: { annual: CaktoPlanConfig; lifetime: CaktoPlanConfig };
    legacyCaktoPlans?: { annual: CaktoPlanConfig; lifetime: CaktoPlanConfig };
    abacatePay?: AbacatePayConfig & { publicAppUrl: string };
    idGenerator?: () => string;
    callbackGenerator?: () => string;
    clock?: () => Date;
  } = {},
) {
  const drafts = new SqliteDraftRepository(db);
  const purchases = new SqlitePurchaseRepository(db, options.adminEmail);
  const inbox = new SqliteWebhookInboxRepository(db);
  const analytics = new SqliteAnalyticsRepository(db);
  const checkoutLinks = options.checkoutUrl
    ? new CaktoHostedCheckoutLink(options.checkoutUrl)
    : undefined;
  const planLinks = options.plans
    ? {
      annual: new CaktoHostedCheckoutLink(options.plans.annual.checkoutUrl),
      lifetime: new CaktoHostedCheckoutLink(options.plans.lifetime.checkoutUrl),
    }
    : undefined;
  const abacatePayPlans = options.abacatePay?.plans;
  const abacatePayPlanLinks = options.abacatePay && abacatePayPlans
    ? {
      annual: new AbacatePayHostedCheckoutLink({
        apiKey: options.abacatePay.apiKey,
        productId: abacatePayPlans.annual.productId,
        publicAppUrl: options.abacatePay.publicAppUrl,
      }),
      lifetime: new AbacatePayHostedCheckoutLink({
        apiKey: options.abacatePay.apiKey,
        productId: abacatePayPlans.lifetime.productId,
        publicAppUrl: options.abacatePay.publicAppUrl,
      }),
    }
    : undefined;
  const legacyCaktoPlans = [options.plans, options.legacyCaktoPlans].filter(
    (plans): plans is { annual: CaktoPlanConfig; lifetime: CaktoPlanConfig } => Boolean(plans),
  );
  const webhookSecrets = [
    ...legacyCaktoPlans.flatMap((plans) => [plans.annual.webhookSecret, plans.lifetime.webhookSecret]),
    ...(options.webhookSecret ? [options.webhookSecret] : []),
  ];
  const expectedProductIds = [
    ...(abacatePayPlanLinks && abacatePayPlans
      ? [abacatePayPlans.annual.productId, abacatePayPlans.lifetime.productId]
      : []),
    ...legacyCaktoPlans.flatMap((plans) => [plans.annual.productId, plans.lifetime.productId]),
    ...(options.expectedProductId ? [options.expectedProductId] : []),
  ];
  const productPlans = Object.fromEntries([
    ...(abacatePayPlanLinks && abacatePayPlans
      ? [
        [abacatePayPlans.annual.productId, 'annual'],
        [abacatePayPlans.lifetime.productId, 'lifetime'],
      ]
      : []),
    ...legacyCaktoPlans.flatMap((plans) => [
      [plans.annual.productId, 'annual'],
      [plans.lifetime.productId, 'lifetime'],
    ]),
  ]) as Readonly<Record<string, 'annual' | 'lifetime'>> | undefined;
  const idGenerator = options.idGenerator ?? randomUUID;
  const callbackGenerator = options.callbackGenerator;
  const clock = options.clock ?? (() => new Date());

  return {
    createCheckout: (input: { draftId: string; userId?: string; plan?: CheckoutPlan }) => {
      if (options.abacatePay && !options.abacatePay.plans) {
        throw new CheckoutNotConfiguredError();
      }
      if ((abacatePayPlanLinks || planLinks) && !input.plan) {
        throw new CheckoutPlanRequiredError();
      }
      const checkoutLink = abacatePayPlanLinks && input.plan
        ? abacatePayPlanLinks[input.plan]
        : planLinks && input.plan
          ? planLinks[input.plan]
          : checkoutLinks;
      if (!checkoutLink || expectedProductIds.length === 0) {
        throw new CheckoutNotConfiguredError();
      }
      return createCheckout(input, {
        drafts,
        purchases,
        checkoutLinks: checkoutLink,
        generateId: idGenerator,
        ...(callbackGenerator ? { generateCallback: callbackGenerator } : {}),
        clock,
      });
    },
    getPurchaseStatus: (input: Parameters<typeof getPurchaseStatus>[0]) =>
      getPurchaseStatus(input, { purchases, clock }),
    listUserAccess: (input: Parameters<typeof listUserAccess>[0]) => listUserAccess(input, { purchases, clock }),
    userHasActiveGrantForDraft: (input: Parameters<typeof userHasActiveGrantForDraft>[0]) =>
      userHasActiveGrantForDraft(input, { purchases, clock }),
    acceptCaktoWebhook: (input: { rawBody: Buffer; headers: CaktoWebhookHeaders }) => {
      if (webhookSecrets.length === 0) {
        throw new WebhookNotConfiguredError();
      }
      const now = clock();
      const events = parseCaktoWebhook(input.rawBody, input.headers, {
        secrets: webhookSecrets,
        now,
      });
      return persistPaymentEvents(events, {
        inbox,
        generateId: idGenerator,
        clock: () => now,
      });
    },
    acceptAbacatePayWebhook: (input: { rawBody: Buffer; headers: AbacatePayWebhookHeaders }) => {
      if (!options.abacatePay) {
        throw new WebhookNotConfiguredError();
      }
      const now = clock();
      const events = parseAbacatePayWebhook(input.rawBody, input.headers, {
        secret: options.abacatePay.webhookSecret,
        signatureKey: options.abacatePay.signatureKey,
      });
      return persistPaymentEvents(events, {
        inbox,
        generateId: idGenerator,
        clock: () => now,
      });
    },
    processPaymentInboxBatch: (limit = 25) =>
      processPaymentInboxBatch(
        {
          inbox,
          purchases,
          analytics,
          ...(expectedProductIds.length > 0 ? { expectedProductIds } : {}),
          ...(productPlans ? { productPlans } : {}),
          generateId: idGenerator,
          clock,
        },
        limit,
      ),
    processCaktoInboxBatch: (limit = 25) =>
      processPaymentInboxBatch(
        {
          inbox,
          purchases,
          analytics,
          ...(expectedProductIds.length > 0 ? { expectedProductIds } : {}),
          ...(productPlans ? { productPlans } : {}),
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
