import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type { JsonObject } from '../../domain/shared/json-value.js';
import type { PurchaseStatus } from '../../domain/commerce/purchase.js';

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    definition: text('definition', { mode: 'json' }).$type<JsonObject>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.version] }),
    uniqueIndex('templates_one_active_version_per_id')
      .on(table.id)
      .where(sql`${table.isActive} = 1`),
    index('templates_active_id_version').on(table.id, table.isActive, table.version),
  ],
);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
    ownerUserId: text('owner_user_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.templateId, table.templateVersion],
      foreignColumns: [templates.id, templates.version],
      name: 'drafts_template_version_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
      name: 'drafts_owner_user_id_fk',
    }).onDelete('set null'),
    index('drafts_template_reference').on(table.templateId, table.templateVersion),
    index('drafts_owner_user_id').on(table.ownerUserId),
  ],
);

export const magicLoginTokens = sqliteTable(
  'magic_login_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('magic_login_tokens_email_created').on(table.email, table.createdAt),
    index('magic_login_tokens_expiry').on(table.expiresAt),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: 'sessions_user_id_fk' })
      .onDelete('cascade'),
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_id_expiry').on(table.userId, table.expiresAt),
  ],
);

export const purchases = sqliteTable(
  'purchases',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id').notNull(),
    ownerUserId: text('owner_user_id'),
    callbackHash: text('callback_hash').notNull(),
    providerOrderId: text('provider_order_id'),
    customerEmail: text('customer_email'),
    status: text('status').$type<PurchaseStatus>().notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId],
      foreignColumns: [drafts.id],
      name: 'purchases_draft_id_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
      name: 'purchases_owner_user_id_fk',
    }).onDelete('set null'),
    uniqueIndex('purchases_callback_hash_unique').on(table.callbackHash),
    uniqueIndex('purchases_provider_order_id_unique').on(table.providerOrderId),
    index('purchases_draft_created').on(table.draftId, table.createdAt),
    index('purchases_status_updated').on(table.status, table.updatedAt),
    index('purchases_owner_user_created').on(table.ownerUserId, table.createdAt),
  ],
);

export const accessGrants = sqliteTable(
  'access_grants',
  {
    id: text('id').primaryKey(),
    purchaseId: text('purchase_id').notNull(),
    userId: text('user_id'),
    customerEmail: text('customer_email').notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull(),
    grantedAt: integer('granted_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.purchaseId],
      foreignColumns: [purchases.id],
      name: 'access_grants_purchase_id_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'access_grants_user_id_fk',
    }).onDelete('set null'),
    uniqueIndex('access_grants_purchase_id_unique').on(table.purchaseId),
    index('access_grants_user_status').on(table.userId, table.status),
    index('access_grants_email_status').on(table.customerEmail, table.status),
  ],
);

export const publications = sqliteTable(
  'publications',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    slug: text('slug').notNull(),
    status: text('status').$type<'published' | 'unpublished'>().notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
    unpublishedAt: integer('unpublished_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.draftId], foreignColumns: [drafts.id], name: 'publications_draft_id_fk' })
      .onDelete('cascade'),
    foreignKey({
      columns: [table.ownerUserId],
      foreignColumns: [users.id],
      name: 'publications_owner_user_id_fk',
    }).onDelete('cascade'),
    uniqueIndex('publications_draft_unique').on(table.draftId),
    uniqueIndex('publications_slug_unique').on(table.slug),
    index('publications_owner_status').on(table.ownerUserId, table.status),
  ],
);

export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    name: text('name').notNull(),
    userId: text('user_id'),
    draftId: text('draft_id'),
    purchaseId: text('purchase_id'),
    publicationId: text('publication_id'),
    templateId: text('template_id'),
    source: text('source'),
    medium: text('medium'),
    campaign: text('campaign'),
    referrerHost: text('referrer_host'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: 'analytics_user_id_fk' })
      .onDelete('set null'),
    foreignKey({ columns: [table.draftId], foreignColumns: [drafts.id], name: 'analytics_draft_id_fk' })
      .onDelete('set null'),
    foreignKey({ columns: [table.purchaseId], foreignColumns: [purchases.id], name: 'analytics_purchase_id_fk' })
      .onDelete('set null'),
    foreignKey({
      columns: [table.publicationId],
      foreignColumns: [publications.id],
      name: 'analytics_publication_id_fk',
    }).onDelete('set null'),
    uniqueIndex('analytics_events_dedupe_unique').on(table.dedupeKey),
    index('analytics_events_name_date').on(table.name, table.occurredAt),
    index('analytics_events_purchase').on(table.purchaseId, table.name),
    index('analytics_events_campaign').on(table.name, table.source, table.campaign),
  ],
);

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    dedupeKey: text('dedupe_key').notNull(),
    eventType: text('event_type').notNull(),
    providerOrderId: text('provider_order_id'),
    providerStatus: text('provider_status'),
    callbackHash: text('callback_hash'),
    customerEmail: text('customer_email'),
    productId: text('product_id'),
    offerId: text('offer_id'),
    offerType: text('offer_type'),
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    occurredAt: text('occurred_at'),
    processingStatus: text('processing_status')
      .$type<'pending' | 'processing' | 'processed' | 'failed'>()
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    processingStartedAt: integer('processing_started_at', { mode: 'timestamp_ms' }),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('webhook_events_dedupe_key_unique').on(table.dedupeKey),
    index('webhook_events_status_received').on(table.processingStatus, table.receivedAt),
    index('webhook_events_provider_order').on(table.providerOrderId, table.receivedAt),
  ],
);
