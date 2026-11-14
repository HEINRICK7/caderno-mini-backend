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
import type { AccessPlan, PurchaseStatus } from '../../domain/commerce/purchase.js';
import type { TemplateHomeCategory } from '../../domain/templates/template-catalog.js';

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    definition: text('definition', { mode: 'json' }).$type<JsonObject>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    publicationStatus: text('publication_status').$type<'draft' | 'published' | 'archived'>().notNull().default('archived'),
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
    name: text('name'),
    whatsapp: text('whatsapp'),
    birthDate: text('birth_date'),
    accountStatus: text('account_status').$type<'active' | 'suspended'>().notNull().default('active'),
    emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const merchantCustomers = sqliteTable(
  'merchant_customers',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    name: text('name').notNull(),
    whatsapp: text('whatsapp'),
    email: text('email'),
    address: text('address'),
    notes: text('notes'),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.ownerUserId], foreignColumns: [users.id], name: 'merchant_customers_owner_fk' }).onDelete('cascade'),
    index('merchant_customers_owner_status_updated').on(table.ownerUserId, table.status, table.updatedAt),
    index('merchant_customers_owner_name').on(table.ownerUserId, table.name),
  ],
);

export const merchantCatalogItems = sqliteTable(
  'merchant_catalog_items',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    kind: text('kind').$type<'product' | 'service'>().notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceMinor: integer('price_minor').notNull(),
    status: text('status').$type<'active' | 'archived'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.ownerUserId], foreignColumns: [users.id], name: 'merchant_catalog_items_owner_fk' }).onDelete('cascade'),
    index('merchant_catalog_items_owner_status_updated').on(table.ownerUserId, table.status, table.updatedAt),
    index('merchant_catalog_items_owner_kind_name').on(table.ownerUserId, table.kind, table.name),
  ],
);

export const merchantSales = sqliteTable(
  'merchant_sales',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    condition: text('condition').$type<'cash' | 'single_due' | 'installments'>().notNull(),
    totalMinor: integer('total_minor').notNull(),
    downPaymentMinor: integer('down_payment_minor').notNull(),
    financedMinor: integer('financed_minor').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.ownerUserId], foreignColumns: [users.id], name: 'merchant_sales_owner_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.customerId], foreignColumns: [merchantCustomers.id], name: 'merchant_sales_customer_fk' }).onDelete('restrict'),
    index('merchant_sales_owner_customer_created').on(table.ownerUserId, table.customerId, table.createdAt),
  ],
);

export const merchantSaleItems = sqliteTable(
  'merchant_sale_items',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    saleId: text('sale_id').notNull(),
    catalogItemId: text('catalog_item_id'),
    kind: text('kind').$type<'product' | 'service' | 'other'>().notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.saleId], foreignColumns: [merchantSales.id], name: 'merchant_sale_items_sale_fk' }).onDelete('cascade'),
    index('merchant_sale_items_owner_sale').on(table.ownerUserId, table.saleId),
  ],
);

export const merchantInstallments = sqliteTable(
  'merchant_installments',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    saleId: text('sale_id').notNull(),
    number: integer('number').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    dueDate: text('due_date').notNull(),
    status: text('status').$type<'open' | 'canceled'>().notNull().default('open'),
  },
  (table) => [
    foreignKey({ columns: [table.saleId], foreignColumns: [merchantSales.id], name: 'merchant_installments_sale_fk' }).onDelete('cascade'),
    uniqueIndex('merchant_installments_sale_number_unique').on(table.saleId, table.number),
    index('merchant_installments_owner_customer_due').on(table.ownerUserId, table.customerId, table.dueDate),
    index('merchant_installments_owner_due_status').on(table.ownerUserId, table.dueDate, table.status),
  ],
);

export const merchantPayments = sqliteTable(
  'merchant_payments',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    saleId: text('sale_id').notNull(),
    installmentId: text('installment_id'),
    amountMinor: integer('amount_minor').notNull(),
    method: text('method').$type<'pix' | 'cash' | 'bank_transfer' | 'other'>().notNull(),
    reference: text('reference'),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.saleId], foreignColumns: [merchantSales.id], name: 'merchant_payments_sale_fk' }).onDelete('restrict'),
    foreignKey({ columns: [table.installmentId], foreignColumns: [merchantInstallments.id], name: 'merchant_payments_installment_fk' }).onDelete('restrict'),
    index('merchant_payments_owner_sale_paid').on(table.ownerUserId, table.saleId, table.paidAt),
    index('merchant_payments_owner_installment').on(table.ownerUserId, table.installmentId),
  ],
);

export const merchantRecurringPlans = sqliteTable(
  'merchant_recurring_plans',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    description: text('description').notNull(),
    catalogItemId: text('catalog_item_id'),
    amountMinor: integer('amount_minor').notNull(),
    frequency: text('frequency').$type<'weekly' | 'fortnightly' | 'monthly'>().notNull(),
    startDate: text('start_date').notNull(),
    dueDay: integer('due_day'),
    endDate: text('end_date'),
    totalCycles: integer('total_cycles'),
    status: text('status').$type<'active' | 'paused' | 'ended'>().notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.customerId], foreignColumns: [merchantCustomers.id], name: 'merchant_recurring_customer_fk' }).onDelete('restrict'),
    index('merchant_recurring_owner_status').on(table.ownerUserId, table.status),
    index('merchant_recurring_owner_customer').on(table.ownerUserId, table.customerId),
  ],
);

export const merchantRecurringRates = sqliteTable(
  'merchant_recurring_rates',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    planId: text('plan_id').notNull(),
    effectiveDate: text('effective_date').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.planId], foreignColumns: [merchantRecurringPlans.id], name: 'merchant_recurring_rates_plan_fk' }).onDelete('cascade'),
    uniqueIndex('merchant_recurring_rates_plan_effective_unique').on(table.planId, table.effectiveDate),
    index('merchant_recurring_rates_owner_plan').on(table.ownerUserId, table.planId, table.effectiveDate),
  ],
);

export const merchantRecurringPauses = sqliteTable(
  'merchant_recurring_pauses',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    planId: text('plan_id').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.planId], foreignColumns: [merchantRecurringPlans.id], name: 'merchant_recurring_pauses_plan_fk' }).onDelete('cascade'),
    index('merchant_recurring_pauses_owner_plan').on(table.ownerUserId, table.planId, table.startDate),
  ],
);

export const merchantRecurringCharges = sqliteTable(
  'merchant_recurring_charges',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    planId: text('plan_id').notNull(),
    periodKey: text('period_key').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    dueDate: text('due_date').notNull(),
    status: text('status').$type<'open' | 'canceled'>().notNull().default('open'),
  },
  (table) => [
    foreignKey({ columns: [table.planId], foreignColumns: [merchantRecurringPlans.id], name: 'merchant_recurring_charges_plan_fk' }).onDelete('restrict'),
    uniqueIndex('merchant_recurring_charges_plan_period_unique').on(table.planId, table.periodKey),
    index('merchant_recurring_charges_owner_due').on(table.ownerUserId, table.dueDate, table.status),
    index('merchant_recurring_charges_owner_customer').on(table.ownerUserId, table.customerId, table.dueDate),
  ],
);

export const merchantRecurringPayments = sqliteTable(
  'merchant_recurring_payments',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    planId: text('plan_id').notNull(),
    chargeId: text('charge_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    method: text('method').$type<'pix' | 'cash' | 'bank_transfer' | 'other'>().notNull(),
    reference: text('reference'),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.chargeId], foreignColumns: [merchantRecurringCharges.id], name: 'merchant_recurring_payments_charge_fk' }).onDelete('restrict'),
    index('merchant_recurring_payments_owner_charge').on(table.ownerUserId, table.chargeId),
    index('merchant_recurring_payments_owner_paid').on(table.ownerUserId, table.paidAt),
  ],
);

export const adminAuditLog = sqliteTable(
  'admin_audit_log',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').notNull(),
    targetUserId: text('target_user_id').notNull(),
    action: text('action').$type<'account_suspended' | 'account_reactivated'>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.actorUserId], foreignColumns: [users.id], name: 'admin_audit_actor_user_fk' }).onDelete('restrict'),
    foreignKey({ columns: [table.targetUserId], foreignColumns: [users.id], name: 'admin_audit_target_user_fk' }).onDelete('restrict'),
    index('admin_audit_target_created').on(table.targetUserId, table.createdAt),
  ],
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

export const merchantChargeMessages = sqliteTable(
  'merchant_charge_messages',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    customerId: text('customer_id').notNull(),
    sourceType: text('source_type').$type<'sale' | 'sale_installment' | 'sale_payment' | 'recurring_charge' | 'recurring_payment'>().notNull(),
    sourceId: text('source_id').notNull(),
    draftId: text('draft_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.ownerUserId], foreignColumns: [users.id], name: 'merchant_charge_messages_owner_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.customerId], foreignColumns: [merchantCustomers.id], name: 'merchant_charge_messages_customer_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.draftId], foreignColumns: [drafts.id], name: 'merchant_charge_messages_draft_fk' }).onDelete('cascade'),
    uniqueIndex('merchant_charge_messages_draft_unique').on(table.draftId),
    index('merchant_charge_messages_owner_customer_created').on(table.ownerUserId, table.customerId, table.createdAt),
    index('merchant_charge_messages_owner_source').on(table.ownerUserId, table.sourceType, table.sourceId),
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
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    saleSource: text('sale_source').$type<'checkout' | 'manual'>().notNull().default('checkout'),
    accessPlan: text('access_plan').$type<AccessPlan>(),
    paymentMethod: text('payment_method').$type<'pix' | 'bank_transfer' | 'cash' | 'other'>(),
    paymentReference: text('payment_reference'),
    recordedByAdminEmail: text('recorded_by_admin_email'),
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

export const adminAuditEvents = sqliteTable(
  'admin_audit_events',
  {
    id: text('id').primaryKey(),
    actorEmail: text('actor_email').notNull(),
    targetUserId: text('target_user_id').notNull(),
    action: text('action').$type<'account_suspended' | 'account_reactivated' | 'manual_payment_recorded' | 'manual_platform_sale_recorded' | 'customer_created'>().notNull(),
    purchaseId: text('purchase_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.targetUserId], foreignColumns: [users.id], name: 'admin_audit_events_target_user_fk' }).onDelete('restrict'),
    foreignKey({ columns: [table.purchaseId], foreignColumns: [purchases.id], name: 'admin_audit_events_purchase_fk' }).onDelete('set null'),
    index('admin_audit_events_target_created').on(table.targetUserId, table.createdAt),
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
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
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

export const platformAccessGrants = sqliteTable(
  'platform_access_grants',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull(),
    accessPlan: text('access_plan').$type<AccessPlan>().notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('BRL'),
    paymentMethod: text('payment_method').$type<'pix' | 'bank_transfer' | 'cash' | 'other'>().notNull(),
    paymentReference: text('payment_reference'),
    recordedByAdminEmail: text('recorded_by_admin_email').notNull(),
    grantedAt: integer('granted_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.userId], foreignColumns: [users.id], name: 'platform_access_grants_user_fk' }).onDelete('restrict'),
    index('platform_access_grants_user_status').on(table.userId, table.status),
    index('platform_access_grants_expiry').on(table.userId, table.expiresAt),
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

export const demoPublications = sqliteTable(
  'demo_publications',
  {
    slug: text('slug').primaryKey(),
    visitorHash: text('visitor_hash').notNull(),
    category: text('category').$type<TemplateHomeCategory>().notNull(),
    draftId: text('draft_id').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    templateName: text('template_name').notNull(),
    templateDescription: text('template_description'),
    templateDefinition: text('template_definition', { mode: 'json' }).$type<JsonObject>().notNull(),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.draftId], foreignColumns: [drafts.id], name: 'demo_publications_draft_id_fk' })
      .onDelete('cascade'),
    uniqueIndex('demo_publications_visitor_category_unique').on(table.visitorHash, table.category),
    index('demo_publications_expiry').on(table.expiresAt),
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
    sideEffectDedupeKey: text('side_effect_dedupe_key'),
    eventType: text('event_type').notNull(),
    providerOrderId: text('provider_order_id'),
    providerStatus: text('provider_status'),
    callbackHash: text('callback_hash'),
    customerEmail: text('customer_email'),
    productId: text('product_id'),
    offerId: text('offer_id'),
    offerType: text('offer_type'),
    planFrequency: text('plan_frequency'),
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

export const webhookEventEffects = sqliteTable(
  'webhook_event_effects',
  {
    effectKey: text('effect_key').primaryKey(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
);
