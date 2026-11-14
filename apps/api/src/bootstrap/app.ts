import fastifySwagger from '@fastify/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyRawBody from 'fastify-raw-body';
import Fastify, { LogController } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyLoggerOptions } from 'fastify';
import { ADMIN_SESSION_TTL_SECONDS, createAdminSessionToken, getAdminSessionEmail, verifyAdminPassword } from '../application/use-cases/admin-auth.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';

import {
  CheckoutNotConfiguredError,
  CheckoutPlanRequiredError,
  CheckoutProviderUnavailableError,
  DemoPublicationNotFoundError,
  DraftNotFoundError,
  ExportContentTooLargeError,
  AnalyticsRangeError,
  InvalidMagicLinkError,
  InvalidCaktoWebhookError,
  InvalidAbacatePayWebhookPayloadError,
  UnauthorizedAbacatePayWebhookError,
  InvalidImageUploadError,
  ImageStorageUnavailableError,
  MagicLinkDeliveryError,
  PurchaseNotFoundError,
  PublicationAccessDeniedError,
  TemplateNotFoundError,
  TrialCategoryUnavailableError,
  WebhookNotConfiguredError,
} from '../application/errors.js';
import {
  TemplateFinancialStateError,
  InvalidTemplateDefinitionError,
  TemplateInputValidationError,
} from '../domain/templates/errors.js';
import { MAX_IMAGE_DATA_URL_LENGTH, MAX_IMAGE_UPLOAD_BODY_BYTES } from '../domain/images/image-limits.js';
import type { Draft } from '../domain/drafts/draft.js';
import { resolveTemplateBusinessName } from '../domain/templates/template-brand.js';
import { normalizeEmail } from '../domain/identity/identity.js';
import { MerchantRecordNotFoundError } from '../application/use-cases/merchant-directory.js';
import { MerchantLedgerNotFoundError } from '../application/use-cases/merchant-ledger.js';
import { MerchantLedgerRuleError } from '../domain/merchant/merchant-ledger.js';
import { MerchantChargeMessageConflictError } from '../application/use-cases/merchant-charge-messages.js';
import type { InstallmentStatus, MerchantPayment, MerchantSale, SaleInstallment, SaleItem } from '../domain/merchant/merchant-ledger.js';
import type { RecurringPayment } from '../domain/merchant/merchant-recurring.js';
import type { MerchantLedgerSale } from '../application/ports/merchant-ledger-repository.js';
import type {
  AnalyticsServices,
  ApplicationServices,
  CommerceServices,
  IdentityServices,
  PublishingServices,
  PreviewServices,
  ImageServices,
  DemoServices,
  AdminServices,
  MerchantDirectoryServices,
  MerchantLedgerServices,
  MerchantRecurringServices,
  MerchantChargeMessageServices,
} from './services.js';

// Request bodies have already passed through Fastify's JSON parser; arbitrary JSON values are valid here.
const jsonObjectSchema = z.record(z.string(), z.any());
const templateResponseSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  definition: jsonObjectSchema,
  createdAt: z.string().datetime(),
});
const adminTemplateResponseSchema = templateResponseSchema.extend({
  isActive: z.boolean(),
  publicationStatus: z.enum(['draft', 'published', 'archived']),
});
const adminTemplatesResponseSchema = z.object({ data: z.array(adminTemplateResponseSchema) });
const adminCreateTemplateBodySchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable(),
  definition: jsonObjectSchema,
}).strict();
const adminUpdateTemplateBodySchema = adminCreateTemplateBodySchema.omit({ id: true });
const adminValidateTemplateBodySchema = z.object({ definition: jsonObjectSchema }).strict();
const adminArchiveTemplateResponseSchema = z.object({ data: z.object({ changed: z.boolean() }) });
const adminTemplateValidationResponseSchema = z.object({ data: z.object({ valid: z.literal(true) }) });
const templateValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
const draftResponseSchema = z.object({
  id: z.uuid(),
  templateId: z.string(),
  templateVersion: z.number().int(),
  data: jsonObjectSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(templateValidationIssueSchema).optional(),
  }),
});

function adminSqliteDiagnostic(error: unknown) {
  if (!(error instanceof Error) || error.name !== 'SqliteError') return undefined;
  const sqliteError = error as Error & { code?: unknown };
  const message = error.message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email redigido]')
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9._-]{32,}\b/gi, '[token redigido]')
    .slice(0, 240);
  return {
    ...(typeof sqliteError.code === 'string' ? { sqliteCode: sqliteError.code } : {}),
    sqliteMessage: message,
  };
}

const idParamsSchema = z.object({ id: z.uuid() }).strict();
const templateIdParamsSchema = z.object({ id: z.string().min(1).max(120) }).strict();
const adminTemplateVersionParamsSchema = z.object({
  id: z.string().min(1).max(120),
  version: z.coerce.number().int().positive(),
}).strict();
const createDraftBodySchema = z
  .object({ templateId: z.string().min(1).max(120), data: jsonObjectSchema })
  .strict();
const validateTemplateBodySchema = z.object({ data: jsonObjectSchema }).strict();
const uploadImageBodySchema = z.object({ dataUrl: z.string().max(MAX_IMAGE_DATA_URL_LENGTH) }).strict();
const updateDraftBodySchema = z.object({ data: jsonObjectSchema }).strict();
const magicLinkBodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const verifyMagicLinkBodySchema = z.object({ token: z.string().min(32).max(256) }).strict();
const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: z.string().datetime(),
});
const authUserResponseSchema = userResponseSchema.extend({
  name: z.string().nullable(),
  whatsapp: z.string().nullable(),
  birthDate: z.iso.date().nullable(),
  profileComplete: z.boolean(),
});
const sessionResponseSchema = z.object({ data: z.object({ user: authUserResponseSchema }) });
const customerProfileBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().min(8).max(24).regex(/^\+?[\d\s().-]+$/).refine((value) => {
    const length = value.replace(/\D/g, '').length;
    return length >= 10 && length <= 15;
  }),
  birthDate: z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10)),
}).strict();
const authMessageResponseSchema = z.object({ data: z.object({ message: z.string() }) });
const adminSessionBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(1_024),
}).strict();
const adminSessionResponseSchema = z.object({ data: z.object({ email: z.email() }) });
const attributionSchema = z.object({
  source: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  medium: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  campaign: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  referrerUrl: z.url().max(2_048).optional(),
}).strict();
const createCheckoutBodySchema = z.object({
  draftId: z.uuid(),
  plan: z.enum(['annual', 'lifetime']).optional(),
  attribution: attributionSchema.optional(),
}).strict();
const createDemoPublicationBodySchema = z.object({ draftId: z.uuid() }).strict();
const demoCategorySchema = z.enum(['relacionamento', 'cobrancas', 'ofertas', 'servicos']);
const demoPublicationResponseSchema = z.object({
  data: z.object({
    slug: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    publicPath: z.string(),
    publicUrl: z.url(),
    category: demoCategorySchema,
    created: z.boolean(),
    expiresAt: z.string().datetime(),
  }),
});
const publicDemoPublicationResponseSchema = z.object({
  data: z.object({
    slug: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    category: demoCategorySchema,
    templateId: z.string(),
    templateVersion: z.number().int().positive(),
    templateName: z.string(),
    templateDescription: z.string().nullable(),
    templateDefinition: jsonObjectSchema,
    data: jsonObjectSchema,
    publicUrl: z.url(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }),
});
const checkoutResponseSchema = z.object({
  data: z.object({ purchaseId: z.uuid(), checkoutUrl: z.url(), status: z.literal('pending') }),
});
const purchaseStatusResponseSchema = z.object({
  data: z.object({
    purchaseId: z.uuid(),
    draftId: z.uuid(),
    status: z.enum(['pending', 'paid', 'refunded', 'chargedback', 'canceled', 'refused']),
    accessStatus: z.enum(['active', 'revoked', 'none']),
    amountMinor: z.number().int().positive().nullable(),
    currency: z.string().length(3).nullable(),
    expiresAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
  }),
});
const userAccessItemSchema = z.object({
  purchaseId: z.uuid(),
  draftId: z.uuid(),
  purchaseStatus: z.enum(['pending', 'paid', 'refunded', 'chargedback', 'canceled', 'refused']),
  accessStatus: z.enum(['active', 'revoked', 'none']),
  grantedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
});
const platformAccessSummarySchema = z.object({
  active: z.boolean(),
  accessPlan: z.enum(['annual', 'lifetime']).nullable(),
  expiresAt: z.string().datetime().nullable(),
});
const customerPortalResponseSchema = z.object({
  data: z.object({
    user: authUserResponseSchema,
    platformAccess: platformAccessSummarySchema,
    accountAccess: z.array(userAccessItemSchema),
    drafts: z.array(z.object({
      id: z.uuid(),
      templateId: z.string(),
      templateName: z.string(),
      businessName: z.string().max(80),
      shareVariables: z.object({
        nome_cliente: z.string().max(60).optional(),
        nome_empresa: z.string().max(80).optional(),
        valor: z.union([z.string().max(40), z.number().finite()]).optional(),
        vencimento: z.string().max(80).optional(),
        produto: z.string().max(200).optional(),
        servico: z.string().max(200).optional(),
      }).strict(),
      updatedAt: z.string().datetime(),
    })),
  }),
});
const merchantCustomerStatusSchema = z.enum(['active', 'archived']);
const merchantRecordStatusQuerySchema = z.enum(['active', 'archived', 'all']);
const merchantCustomerBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  whatsapp: z.string().trim().max(24).regex(/^\+?[\d\s().-]*$/).optional(),
  email: z.string().trim().email().max(254).optional(),
  address: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2_000).optional(),
  status: merchantCustomerStatusSchema.optional(),
}).strict();
const merchantCustomerUpdateBodySchema = merchantCustomerBodySchema.extend({ status: merchantCustomerStatusSchema });
const merchantCatalogItemKindSchema = z.enum(['product', 'service']);
const merchantCatalogItemBodySchema = z.object({
  kind: merchantCatalogItemKindSchema,
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
  priceMinor: z.number().int().min(0).max(99_999_999),
  status: merchantCustomerStatusSchema.optional(),
}).strict();
const merchantCatalogItemUpdateBodySchema = merchantCatalogItemBodySchema.extend({ status: merchantCustomerStatusSchema });
const merchantDirectoryIdParamsSchema = z.object({ id: z.uuid() }).strict();
const merchantLedgerIdParamsSchema = z.object({ id: z.string().min(1).max(120) }).strict();
const merchantDirectoryListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: merchantRecordStatusQuerySchema.optional(),
  kind: merchantCatalogItemKindSchema.optional(),
}).strict();
const merchantCustomerResponseSchema = z.object({
  id: z.uuid(), name: z.string(), whatsapp: z.string().nullable(), email: z.string().nullable(),
  address: z.string().nullable(), notes: z.string().nullable(), status: merchantCustomerStatusSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const merchantCatalogItemResponseSchema = z.object({
  id: z.uuid(), kind: merchantCatalogItemKindSchema, name: z.string(), description: z.string().nullable(),
  priceMinor: z.number().int().nonnegative(), status: merchantCustomerStatusSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const merchantCustomerListResponseSchema = z.object({ data: z.array(merchantCustomerResponseSchema) });
const merchantCustomerResponseEnvelopeSchema = z.object({ data: merchantCustomerResponseSchema });
const merchantCatalogItemListResponseSchema = z.object({ data: z.array(merchantCatalogItemResponseSchema) });
const merchantCatalogItemResponseEnvelopeSchema = z.object({ data: merchantCatalogItemResponseSchema });
const merchantSaleConditionSchema = z.enum(['cash', 'single_due', 'installments']);
const merchantPaymentMethodSchema = z.enum(['pix', 'cash', 'bank_transfer', 'other']);
const merchantSaleLineBodySchema = z.object({
  catalogItemId: z.uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['product', 'service', 'other']).optional(),
  quantity: z.number().int().min(1).max(10_000),
  unitPriceMinor: z.number().int().min(0).max(99_999_999).optional(),
}).strict().refine((item) => Boolean(item.catalogItemId) || Boolean(item.name && item.kind && item.unitPriceMinor !== undefined));
const merchantRegisterSaleBodySchema = z.object({
  customerId: z.uuid(),
  items: z.array(merchantSaleLineBodySchema).min(1).max(100),
  condition: merchantSaleConditionSchema,
  downPaymentMinor: z.number().int().min(0).max(99_999_999).optional(),
  initialPaymentMethod: merchantPaymentMethodSchema.optional(),
  installmentCount: z.number().int().min(2).max(120).optional(),
  firstDueDate: z.iso.date().optional(),
}).strict().refine((input) => input.condition !== 'installments' || input.installmentCount !== undefined);
const merchantPaymentBodySchema = z.object({
  amountMinor: z.number().int().min(1).max(99_999_999),
  method: merchantPaymentMethodSchema,
  reference: z.string().trim().max(240).optional(),
}).strict();
const merchantSaleItemResponseSchema = z.object({
  id: z.string(), catalogItemId: z.string().nullable(), kind: z.enum(['product', 'service', 'other']),
  name: z.string(), quantity: z.number().int().positive(), unitPriceMinor: z.number().int().nonnegative(), lineTotalMinor: z.number().int().nonnegative(),
});
const merchantInstallmentResponseSchema = z.object({
  id: z.string(), number: z.number().int().positive(), amountMinor: z.number().int().positive(), dueDate: z.iso.date(),
  status: z.enum(['open', 'canceled']), paidMinor: z.number().int().nonnegative().optional(),
  balanceMinor: z.number().int().nonnegative().optional(),
  derivedStatus: z.enum(['pending', 'due_today', 'overdue', 'partially_paid', 'paid', 'canceled']).optional(),
});
const merchantPaymentResponseSchema = z.object({
  id: z.string(), saleId: z.uuid(), installmentId: z.string().nullable(), amountMinor: z.number().int().positive(),
  method: merchantPaymentMethodSchema, reference: z.string().nullable(), paidAt: z.string().datetime(),
});
const merchantSaleResponseSchema = z.object({
  id: z.uuid(), customerId: z.uuid(), condition: merchantSaleConditionSchema,
  totalMinor: z.number().int().positive(), downPaymentMinor: z.number().int().nonnegative(), financedMinor: z.number().int().nonnegative(),
  items: z.array(merchantSaleItemResponseSchema), installments: z.array(merchantInstallmentResponseSchema),
  payments: z.array(merchantPaymentResponseSchema), balanceMinor: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
});
const merchantSaleResponseEnvelopeSchema = z.object({ data: merchantSaleResponseSchema });
const merchantCustomerLedgerResponseSchema = z.object({ data: z.object({
  customer: merchantCustomerResponseSchema,
  sales: z.array(merchantSaleResponseSchema),
}) });
const merchantPaymentResponseEnvelopeSchema = z.object({ data: merchantPaymentResponseSchema });
const merchantLedgerOverviewResponseSchema = z.object({ data: z.object({
  customerCount: z.number().int().nonnegative(), saleCount: z.number().int().nonnegative(),
  dueToday: z.array(z.any()), overdue: z.array(z.any()), upcoming: z.array(z.any()), recentPayments: z.array(z.any()),
}) });
const merchantChargeMessageSourceTypeSchema = z.enum(['sale', 'sale_installment', 'sale_payment', 'recurring_charge', 'recurring_payment']);
const merchantChargeMessageBodySchema = z.object({
  sourceType: merchantChargeMessageSourceTypeSchema,
  sourceId: z.string().trim().min(1).max(120),
  draftId: z.uuid(),
}).strict();
const merchantChargeMessageResponseSchema = z.object({
  id: z.uuid(), customerId: z.uuid(), sourceType: merchantChargeMessageSourceTypeSchema,
  sourceId: z.string(), draftId: z.uuid(), templateId: z.string(), templateName: z.string(), createdAt: z.string().datetime(),
});
const merchantChargeMessageLinkedSchema = z.object({
  id: z.uuid(), customerId: z.uuid(), sourceType: merchantChargeMessageSourceTypeSchema,
  sourceId: z.string(), draftId: z.uuid(), createdAt: z.string().datetime(),
});
const merchantChargeMessageEnvelopeSchema = z.object({ data: merchantChargeMessageLinkedSchema });
const merchantChargeMessageListResponseSchema = z.object({ data: z.array(merchantChargeMessageResponseSchema) });
const merchantRecurringFrequencySchema = z.enum(['weekly', 'fortnightly', 'monthly']);
const merchantRecurringStatusSchema = z.enum(['active', 'paused', 'ended']);
const merchantRecurringCreateBodySchema = z.object({
  customerId: z.uuid(),
  description: z.string().trim().min(2).max(160).optional(),
  catalogItemId: z.uuid().optional(),
  amountMinor: z.number().int().min(1).max(99_999_999).optional(),
  frequency: merchantRecurringFrequencySchema,
  startDate: z.iso.date(),
  dueDay: z.number().int().min(1).max(31).optional(),
  endDate: z.iso.date().optional(),
  totalCycles: z.number().int().min(1).max(120).optional(),
}).strict().refine((input) => input.frequency !== 'monthly' || input.dueDay !== undefined);
const merchantRecurringRateBodySchema = z.object({
  effectiveDate: z.iso.date(),
  amountMinor: z.number().int().min(1).max(99_999_999),
}).strict();
const merchantRecurringPlanParamsSchema = z.object({ id: z.uuid() }).strict();
const merchantRecurringListQuerySchema = z.object({ status: z.enum(['active', 'paused', 'ended', 'all']).optional() }).strict();
const merchantRecurringChargesQuerySchema = z.object({ planId: z.uuid().optional(), customerId: z.uuid().optional() }).strict();
const merchantRecurringPaymentBodySchema = merchantPaymentBodySchema;
const merchantRecurringPaymentResponseSchema = z.object({
  id: z.uuid(), chargeId: z.uuid(), amountMinor: z.number().int().positive(), method: merchantPaymentMethodSchema,
  reference: z.string().nullable(), paidAt: z.string().datetime(),
});
const merchantRecurringChargeResponseSchema = z.object({
  id: z.uuid(), customerId: z.uuid(), planId: z.uuid(), periodKey: z.string(), amountMinor: z.number().int().positive(),
  dueDate: z.iso.date(), status: z.enum(['open', 'canceled']), description: z.string(), frequency: merchantRecurringFrequencySchema,
  customer: z.object({ id: z.uuid(), name: z.string(), whatsapp: z.string().nullable() }),
  payments: z.array(merchantRecurringPaymentResponseSchema), paidMinor: z.number().int().nonnegative(), balanceMinor: z.number().int().nonnegative(),
  derivedStatus: z.enum(['pending', 'due_today', 'overdue', 'partially_paid', 'paid', 'canceled']),
});
const merchantRecurringPlanResponseSchema = z.object({
  id: z.uuid(), customerId: z.uuid(), description: z.string(), catalogItemId: z.string().nullable(), amountMinor: z.number().int().nonnegative(),
  currentAmountMinor: z.number().int().nonnegative(), frequency: merchantRecurringFrequencySchema, startDate: z.iso.date(), dueDay: z.number().int().nullable(),
  endDate: z.iso.date().nullable(), totalCycles: z.number().int().nullable(), status: merchantRecurringStatusSchema,
  rates: z.array(z.object({ effectiveDate: z.iso.date(), amountMinor: z.number().int().nonnegative() })),
  pauses: z.array(z.object({ startDate: z.iso.date(), endDate: z.iso.date().nullable() })),
  charges: z.array(merchantRecurringChargeResponseSchema), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
const merchantRecurringPlansResponseSchema = z.object({ data: z.array(merchantRecurringPlanResponseSchema) });
const merchantRecurringPlanEnvelopeSchema = z.object({ data: merchantRecurringPlanResponseSchema });
const merchantRecurringChargesResponseSchema = z.object({ data: z.array(merchantRecurringChargeResponseSchema) });
const merchantRecurringPaymentEnvelopeSchema = z.object({ data: merchantRecurringPaymentResponseSchema });
const merchantRecurringOverviewResponseSchema = z.object({
  data: z.object({ activePlanCount: z.number().int().nonnegative(), dueToday: z.array(merchantRecurringChargeResponseSchema), overdue: z.array(merchantRecurringChargeResponseSchema), upcoming: z.array(merchantRecurringChargeResponseSchema) }),
});
const merchantChargeMessageContextResponseSchema = z.object({ data: z.object({
  sourceType: merchantChargeMessageSourceTypeSchema, sourceId: z.string(), customerId: z.uuid(),
  customerName: z.string(), businessName: z.string(), amountMinor: z.number().int().positive(), dueDate: z.iso.date().nullable(),
  installmentNumber: z.number().int().positive().nullable(), installmentTotal: z.number().int().positive().nullable(), itemNames: z.array(z.string()),
  paidAt: z.iso.date().nullable(),
}) });

function presentMerchantPayment(payment: MerchantPayment) {
  return {
    id: payment.id,
    saleId: payment.saleId,
    installmentId: payment.installmentId,
    amountMinor: payment.amountMinor,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
  };
}

function presentMerchantSale(sale: MerchantSale | (MerchantLedgerSale & { balanceMinor: number })) {
  const payments = 'payments' in sale ? sale.payments : sale.initialPayment ? [sale.initialPayment] : [];
  return {
    id: sale.id,
    customerId: sale.customerId,
    condition: sale.condition,
    totalMinor: sale.totalMinor,
    downPaymentMinor: sale.downPaymentMinor,
    financedMinor: sale.financedMinor,
    ...( 'balanceMinor' in sale ? { balanceMinor: sale.balanceMinor } : {}),
    items: sale.items.map((item: SaleItem) => ({
      id: item.id, catalogItemId: item.catalogItemId ?? null, kind: item.kind, name: item.name,
      quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, lineTotalMinor: item.lineTotalMinor,
    })),
    installments: sale.installments.map((installment: SaleInstallment & { paidMinor?: number; balanceMinor?: number; derivedStatus?: InstallmentStatus }) => ({
      id: installment.id, number: installment.number, amountMinor: installment.amountMinor,
      dueDate: installment.dueDate, status: installment.status,
      ...(installment.paidMinor === undefined ? {} : { paidMinor: installment.paidMinor }),
      ...(installment.balanceMinor === undefined ? {} : { balanceMinor: installment.balanceMinor }),
      ...(installment.derivedStatus === undefined ? {} : { derivedStatus: installment.derivedStatus }),
    })),
    payments: payments.map(presentMerchantPayment),
    createdAt: sale.createdAt.toISOString(),
  };
}

function presentRecurringPayment(payment: RecurringPayment) {
  return {
    id: payment.id,
    chargeId: payment.chargeId,
    amountMinor: payment.amountMinor,
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
  };
}

function presentRecurringCharge(charge: ReturnType<MerchantRecurringServices['listCharges']>[number]) {
  return {
    id: charge.id,
    customerId: charge.customerId,
    planId: charge.planId,
    periodKey: charge.periodKey,
    amountMinor: charge.amountMinor,
    dueDate: charge.dueDate,
    status: charge.status,
    description: charge.description,
    frequency: charge.frequency,
    customer: charge.customer,
    payments: charge.payments.map(presentRecurringPayment),
    paidMinor: charge.paidMinor,
    balanceMinor: charge.balanceMinor,
    derivedStatus: charge.derivedStatus,
  };
}

function presentRecurringPlan(plan: ReturnType<MerchantRecurringServices['listPlans']>[number]) {
  return {
    id: plan.id,
    customerId: plan.customerId,
    description: plan.description,
    catalogItemId: plan.catalogItemId,
    amountMinor: plan.amountMinor,
    currentAmountMinor: plan.currentAmountMinor,
    frequency: plan.frequency,
    startDate: plan.startDate,
    dueDay: plan.dueDay,
    endDate: plan.endDate,
    totalCycles: plan.totalCycles,
    status: plan.status,
    rates: plan.rates,
    pauses: plan.pauses,
    charges: plan.charges.map(presentRecurringCharge),
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
const adminAccountStatusSchema = z.enum(['active', 'suspended']);
const adminUserSummarySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  accountStatus: adminAccountStatusSchema,
  createdAt: z.string().datetime(),
  activeSessions: z.number().int().nonnegative(),
  purchaseCount: z.number().int().nonnegative(),
  activeLicenses: z.number().int().nonnegative(),
  draftCount: z.number().int().nonnegative(),
});
const adminUsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(254).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
const adminUsersResponseSchema = z.object({
  data: z.object({ total: z.number().int().nonnegative(), users: z.array(adminUserSummarySchema) }),
});
const adminUserResponseSchema = z.object({
  data: z.object({
    user: adminUserSummarySchema.extend({
      name: z.string().nullable(),
      whatsapp: z.string().nullable(),
      birthDate: z.iso.date().nullable(),
    }),
    purchases: z.array(z.object({
      purchaseId: z.uuid(),
      draftId: z.uuid(),
      templateId: z.string(),
      templateName: z.string(),
      purchaseStatus: z.enum(['pending', 'paid', 'refunded', 'chargedback', 'canceled', 'refused']),
      accessStatus: z.enum(['active', 'revoked']).nullable(),
      saleSource: z.enum(['checkout', 'manual']),
      accessPlan: z.enum(['annual', 'lifetime']).nullable(),
      amountMinor: z.number().int().positive().nullable(),
      currency: z.string().length(3).nullable(),
      paymentMethod: z.enum(['pix', 'bank_transfer', 'cash', 'other']).nullable(),
      paymentReference: z.string().nullable(),
      recordedByAdminEmail: z.email().nullable(),
      expiresAt: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })),
    platformSales: z.array(z.object({
      saleId: z.uuid(),
      accessStatus: z.enum(['active', 'expired', 'revoked']),
      accessPlan: z.enum(['annual', 'lifetime']),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3),
      paymentMethod: z.enum(['pix', 'bank_transfer', 'cash', 'other']),
      paymentReference: z.string().nullable(),
      recordedByAdminEmail: z.email(),
      expiresAt: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
    })),
    drafts: z.array(z.object({
      id: z.uuid(),
      templateId: z.string(),
      templateName: z.string(),
      updatedAt: z.string().datetime(),
    })),
    recentActions: z.array(z.object({
      action: z.enum(['account_suspended', 'account_reactivated', 'manual_payment_recorded', 'manual_platform_sale_recorded', 'customer_created']),
      actorEmail: z.email(),
      purchaseId: z.uuid().nullable(),
      createdAt: z.string().datetime(),
    })),
  }),
});
const adminSetUserStatusBodySchema = z.object({ status: adminAccountStatusSchema }).strict();
const adminCreateCustomerBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();
const adminCreateCustomerResponseSchema = z.object({
  data: z.object({
    user: userResponseSchema,
    accessLinkSent: z.boolean(),
  }),
});
const adminManualPaymentBodySchema = z.object({
  draftId: z.uuid(),
  plan: z.enum(['annual', 'lifetime']),
  amountMinor: z.number().int().positive().max(100_000_000),
  paymentMethod: z.enum(['pix', 'bank_transfer', 'cash', 'other']),
  paymentReference: z.string().trim().max(160).optional(),
}).strict();
const adminManualPlatformSaleBodySchema = z.object({
  plan: z.enum(['annual', 'lifetime']),
  amountMinor: z.number().int().positive().max(100_000_000),
  paymentMethod: z.enum(['pix', 'bank_transfer', 'cash', 'other']),
  paymentReference: z.string().trim().max(160).optional(),
  confirmPaymentReceived: z.literal(true),
}).strict();
const adminManualPlatformSaleResponseSchema = z.object({
  data: z.object({
    saleId: z.uuid(),
    accessStatus: z.literal('active'),
    accessPlan: z.enum(['annual', 'lifetime']),
    expiresAt: z.string().datetime().nullable(),
  }),
});
const adminManualPaymentResponseSchema = z.object({
  data: z.object({
    purchaseId: z.uuid(),
    status: z.literal('paid'),
    accessStatus: z.literal('active'),
    expiresAt: z.string().datetime().nullable(),
  }),
});
const adminSetUserStatusResponseSchema = z.object({
  data: z.object({ status: adminAccountStatusSchema, changed: z.boolean(), revokedSessions: z.number().int().nonnegative() }),
});
const publicationResponseSchema = z.object({
  data: z.object({
    slug: z.string(),
    status: z.literal('published'),
    publicPath: z.string(),
    publicUrl: z.url(),
    publishedAt: z.string().datetime(),
  }),
});
const publicMessageResponseSchema = z.object({
  data: z.object({
    templateId: z.string(),
    templateVersion: z.number().int(),
    templateName: z.string(),
    templateDescription: z.string().nullable(),
    templateDefinition: jsonObjectSchema,
    publicUrl: z.url(),
    data: jsonObjectSchema,
    publishedAt: z.string().datetime(),
  }),
});
const analyticsEventBodySchema = z.object({
  eventId: z.uuid(),
  name: z.enum([
    'landing_viewed',
    'template_viewed',
    'template_selected',
    'preview_viewed',
    'whatsapp_share_clicked',
  ]),
  draftId: z.uuid().optional(),
  templateId: z.string().min(1).max(120).optional(),
  source: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  medium: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  campaign: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  referrerUrl: z.url().max(2_048).optional(),
}).strict();
const analyticsSummaryQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
}).strict();
const analyticsSummaryResponseSchema = z.object({
  data: z.object({
    eventCounts: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
    purchaseSources: z.array(z.object({
      source: z.string().nullable(),
      medium: z.string().nullable(),
      campaign: z.string().nullable(),
      purchases: z.number().int().nonnegative(),
    })),
  }),
});
const webhookAcceptedResponseSchema = z.object({
  data: z.object({ accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative() }),
});

export type BuildAppOptions = {
  logger?: boolean | FastifyLoggerOptions;
  services?: ApplicationServices;
  commerceServices?: CommerceServices;
  identityServices?: IdentityServices;
  publishingServices?: PublishingServices;
  demoServices?: DemoServices;
  previewServices?: PreviewServices;
  imageServices?: ImageServices;
  analyticsServices?: AnalyticsServices;
  adminServices?: AdminServices;
  merchantDirectoryServices?: MerchantDirectoryServices;
  merchantLedgerServices?: MerchantLedgerServices;
  merchantRecurringServices?: MerchantRecurringServices;
  merchantChargeMessageServices?: MerchantChargeMessageServices;
  adminEmail?: string;
  adminPasswordHash?: string;
  adminSessionSecret?: string;
  analyticsReadToken?: string;
  authCookieSecure?: boolean;
  authPublicAppUrl?: string;
  publicApiUrl?: string;
  publicAppUrl?: string;
  trustedProxyAddresses?: string[];
  healthCheck?: () => unknown | Promise<unknown>;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    trustProxy: options.trustedProxyAddresses?.length ? options.trustedProxyAddresses : false,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.register(fastifyRateLimit, { global: false });
  app.register(fastifyRawBody, { global: false, encoding: false });
  const authCookieSecure = options.authCookieSecure ?? false;
  const authPublicOrigin = options.authPublicAppUrl ? new URL(options.authPublicAppUrl).origin : undefined;
  const publicApiOrigin = new URL(options.publicApiUrl ?? 'http://localhost:3000').origin;
  const publicAppOrigin = new URL(options.publicAppUrl ?? 'http://localhost:3001').origin;
  const sessionCookieName = authCookieSecure ? '__Host-caderno_session' : 'caderno_session';
  const adminSessionCookieName = authCookieSecure ? '__Host-caderno_admin' : 'caderno_admin';
  const demoVisitorCookieName = authCookieSecure ? '__Host-caderno_demo_visitor' : 'caderno_demo_visitor';
  const getAuthenticatedAdminEmail = (request: FastifyRequest) => getAdminSessionEmail({
    token: request.cookies[adminSessionCookieName],
    email: options.adminEmail,
    secret: options.adminSessionSecret && options.adminPasswordHash
      ? `${options.adminSessionSecret}.${options.adminPasswordHash}`
      : undefined,
  });
  const getAuthenticatedUser = (request: FastifyRequest) => {
    const token = request.cookies[sessionCookieName];
    const customerUser = token && options.identityServices ? options.identityServices.getSession({ token }) : undefined;
    if (customerUser) return customerUser;

    const adminEmail = getAuthenticatedAdminEmail(request);
    if (adminEmail && options.identityServices) {
      return options.identityServices.getAdminTestUser({ email: adminEmail });
    }
    return undefined;
  };
  const requireCustomerSession = (request: FastifyRequest, response: FastifyReply) => {
    const token = request.cookies[sessionCookieName];
    const user = token && options.identityServices ? options.identityServices.getSession({ token }) : undefined;
    if (!user) {
      response.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' } });
      return undefined;
    }
    return user;
  };
  const requireSession = (request: FastifyRequest, response: FastifyReply) => {
    const user = getAuthenticatedUser(request);
    if (!user) {
      response.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' },
      });
      return undefined;
    }
    return user;
  };
  const requireAdmin = (request: FastifyRequest, response: FastifyReply) => {
    const email = getAuthenticatedAdminEmail(request);
    if (!email) {
      response.code(401).send({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Entre com o acesso administrativo.' } });
      return undefined;
    }
    return email;
  };
  const healthResponseSchema = z.object({ status: z.enum(['ok', 'unavailable']) });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request, response) => {
    const isUnsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const routePath = request.routeOptions.url;
    const isIdentityMutation = routePath?.startsWith('/api/v1/auth/') ?? false;
    const isDemoMutation = routePath === '/api/v1/demo-publications';
    const isSessionMutation = [
      '/api/v1/drafts',
      '/api/v1/drafts/:id',
      '/api/v1/account/profile',
      '/api/v1/merchant/customers',
      '/api/v1/merchant/customers/:id',
      '/api/v1/merchant/catalog-items',
      '/api/v1/merchant/catalog-items/:id',
      '/api/v1/merchant/sales',
      '/api/v1/merchant/installments/:id/payments',
      '/api/v1/merchant/recurrences',
      '/api/v1/merchant/recurrences/:id/rate',
      '/api/v1/merchant/recurrences/:id/pause',
      '/api/v1/merchant/recurrences/:id/resume',
      '/api/v1/merchant/recurrences/:id/end',
      '/api/v1/merchant/recurring-charges/:id/payments',
      '/api/v1/merchant/charge-messages',
      '/api/v1/checkout',
      '/api/v1/drafts/:id/publication',
      '/api/v1/analytics/events',
    ].includes(routePath ?? '');
    const isAdminSessionMutation = routePath === '/api/v1/admin/session';
    const isAdminMutation = routePath?.startsWith('/api/v1/admin/users/') || routePath?.startsWith('/api/v1/admin/customers') || routePath?.startsWith('/api/v1/admin/templates') || false;
    const hasSessionCookie = Boolean(request.cookies[sessionCookieName]);
    const hasAdminSessionCookie = Boolean(request.cookies[adminSessionCookieName]);
    const origin = request.headers.origin;
    const isBrowserRequest = origin !== undefined || request.headers['sec-fetch-site'] !== undefined;

    if (
      isUnsafeMethod &&
      isBrowserRequest &&
      (
        isIdentityMutation ||
        isDemoMutation ||
        isAdminSessionMutation ||
        (isSessionMutation && (hasSessionCookie || hasAdminSessionCookie)) ||
        (isAdminMutation && hasAdminSessionCookie)
      ) &&
      origin !== authPublicOrigin
    ) {
      return response.code(403).send({
        error: { code: 'CSRF_ORIGIN_INVALID', message: 'A origem da requisição não é permitida.' },
      });
    }
  });
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Cadernô Express API',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3000' }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.addHook('onResponse', async (request, response) => {
    request.log.info(
      { method: request.method, route: request.routeOptions.url, statusCode: response.statusCode },
      'Requisição HTTP concluída',
    );
  });

  app.addHook('onSend', async (request, response, payload) => {
    if (
      request.routeOptions.url?.startsWith('/api/v1/drafts') ||
      request.routeOptions.url?.startsWith('/api/v1/auth') ||
      request.routeOptions.url?.startsWith('/api/v1/checkout') ||
      request.routeOptions.url?.startsWith('/api/v1/account') ||
      request.routeOptions.url?.startsWith('/api/v1/merchant') ||
      request.routeOptions.url?.startsWith('/api/v1/purchases') ||
      request.routeOptions.url?.startsWith('/api/v1/publications') ||
      request.routeOptions.url?.startsWith('/api/v1/demo-publications') ||
      request.routeOptions.url?.startsWith('/api/v1/analytics') ||
      request.routeOptions.url?.startsWith('/api/v1/webhooks') ||
      request.routeOptions.url?.startsWith('/api/v1/admin')
    ) {
      response.header('cache-control', 'no-store');
    }
    if (request.routeOptions.url?.startsWith('/api/v1/auth')) {
      response.header('cache-control', 'no-store');
      response.header('referrer-policy', 'no-referrer');
    }
    return payload;
  });

  app.setErrorHandler((error, request, response) => {
    if (error instanceof MerchantChargeMessageConflictError) {
      return response.code(409).send({ error: { code: 'MERCHANT_CHARGE_MESSAGE_CONFLICT', message: error.message } });
    }
    if (error instanceof MerchantLedgerNotFoundError) {
      return response.code(404).send({ error: { code: 'MERCHANT_LEDGER_RECORD_NOT_FOUND', message: 'Este compromisso não foi encontrado.' } });
    }
    if (error instanceof MerchantLedgerRuleError) {
      return response.code(400).send({ error: { code: 'MERCHANT_LEDGER_RULE_INVALID', message: error.message } });
    }
    if (error instanceof MerchantRecordNotFoundError) {
      return response.code(404).send({
        error: { code: 'MERCHANT_RECORD_NOT_FOUND', message: 'Este registro não foi encontrado.' },
      });
    }
    if (error instanceof TemplateNotFoundError) {
      return response.code(404).send({
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Modelo não encontrado.' },
      });
    }
    if (error instanceof DraftNotFoundError) {
      return response.code(404).send({
        error: { code: 'DRAFT_NOT_FOUND', message: 'Rascunho não encontrado.' },
      });
    }
    if (error instanceof PurchaseNotFoundError) {
      return response.code(404).send({
        error: { code: 'PURCHASE_NOT_FOUND', message: 'Compra não encontrada.' },
      });
    }
    if (error instanceof PublicationAccessDeniedError) {
      return response.code(403).send({
        error: { code: 'ACTIVE_LICENSE_REQUIRED', message: 'Uma licença ativa é necessária para esta ação.' },
      });
    }
    if (error instanceof TrialCategoryUnavailableError) {
      return response.code(422).send({
        error: { code: 'DEMO_CATEGORY_UNAVAILABLE', message: 'Esta categoria ainda não está disponível para demonstração.' },
      });
    }
    if (error instanceof DemoPublicationNotFoundError) {
      return response.code(404).send({
        error: { code: 'DEMO_PUBLICATION_NOT_FOUND', message: 'Esta demonstração expirou ou não está disponível.' },
      });
    }
    if (error instanceof TemplateFinancialStateError) {
      return response.code(422).send({
        error: { code: 'TEMPLATE_FINANCIAL_STATE_UNAVAILABLE', message: 'A confirmação financeira deste modelo precisa vir da aplicação.' },
      });
    }
    if (error instanceof ExportContentTooLargeError) {
      return response.code(422).send({
        error: { code: 'EXPORT_CONTENT_TOO_LARGE', message: 'O conteúdo ultrapassa o limite para exportação.' },
      });
    }
    if (error instanceof InvalidImageUploadError) {
      return response.code(422).send({
        error: { code: 'IMAGE_UPLOAD_INVALID', message: 'Envie uma imagem PNG, JPEG ou WebP de até 5 MB.' },
      });
    }
    if (error instanceof ImageStorageUnavailableError) {
      return response.code(503).send({
        error: { code: 'IMAGE_STORAGE_UNAVAILABLE', message: 'O armazenamento de imagens está indisponível agora.' },
      });
    }
    if (error instanceof AnalyticsRangeError) {
      return response.code(400).send({
        error: { code: 'INVALID_ANALYTICS_RANGE', message: 'O período deve ter até 90 dias.' },
      });
    }
    if (error instanceof TemplateInputValidationError) {
      return response.code(422).send({
        error: {
          code: 'TEMPLATE_INPUT_INVALID',
          message: 'Revise os campos informados para este modelo.',
          details: error.issues,
        },
      });
    }
    if (error instanceof InvalidTemplateDefinitionError) {
      return response.code(400).send({
        error: { code: 'TEMPLATE_DEFINITION_INVALID', message: 'Revise a definição do template: campos, cartão, identidade visual e categoria do catálogo.' },
      });
    }
    if (error instanceof InvalidMagicLinkError) {
      return response.code(400).send({
        error: { code: 'INVALID_MAGIC_LINK', message: 'O link é inválido ou expirou.' },
      });
    }
    if (error instanceof InvalidCaktoWebhookError) {
      return response.code(401).send({
        error: { code: 'INVALID_WEBHOOK', message: 'A assinatura do webhook é inválida.' },
      });
    }
    if (error instanceof UnauthorizedAbacatePayWebhookError) {
      return response.code(401).send({
        error: { code: 'INVALID_WEBHOOK', message: 'A assinatura do webhook é inválida.' },
      });
    }
    if (error instanceof InvalidAbacatePayWebhookPayloadError) {
      return response.code(400).send({
        error: { code: 'INVALID_WEBHOOK_PAYLOAD', message: 'O conteúdo do webhook é inválido.' },
      });
    }
    if (error instanceof WebhookNotConfiguredError) {
      return response.code(503).send({
        error: { code: 'WEBHOOK_UNAVAILABLE', message: 'O processamento de pagamentos está indisponível.' },
      });
    }
    if (error instanceof MagicLinkDeliveryError) {
      return response.code(503).send({
        error: { code: 'AUTH_DELIVERY_UNAVAILABLE', message: 'Não foi possível enviar o link agora.' },
      });
    }
    if (error instanceof CheckoutNotConfiguredError) {
      return response.code(503).send({
        error: { code: 'CHECKOUT_UNAVAILABLE', message: 'O checkout está indisponível no momento.' },
      });
    }
    if (error instanceof CheckoutProviderUnavailableError) {
      return response.code(503).send({
        error: { code: 'CHECKOUT_UNAVAILABLE', message: 'Não foi possível iniciar o pagamento agora. Tente novamente.' },
      });
    }
    if (error instanceof CheckoutPlanRequiredError) {
      return response.code(400).send({
        error: { code: 'CHECKOUT_PLAN_REQUIRED', message: 'Escolha o plano anual ou o vitalício.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      return response.code(413).send({
        error: { code: 'REQUEST_TOO_LARGE', message: 'A imagem ultrapassa o limite permitido.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 400
    ) {
      return response.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'A requisição é inválida.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      return response.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
      });
    }

    const sqliteDiagnostic = request.routeOptions.url === '/api/v1/admin/users'
      ? adminSqliteDiagnostic(error)
      : undefined;
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : 'UnknownError',
        ...(sqliteDiagnostic ?? {}),
      },
      'Falha ao processar requisição',
    );
    return response.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a requisição.' },
    });
  });

  app.setNotFoundHandler((_request, response) =>
    response.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }),
  );

  app.after(() => {
    app.get(
    '/health',
    { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
    async (_request, response) => {
      try {
        await options.healthCheck?.();
        return { status: 'ok' as const };
      } catch {
        return response.code(503).send({ status: 'unavailable' as const });
      }
    },
    );

    if (options.imageServices) {
      app.post(
        '/api/v1/assets',
        {
          bodyLimit: MAX_IMAGE_UPLOAD_BODY_BYTES,
          schema: {
            tags: ['assets'],
            summary: 'Armazena uma imagem de template no MinIO',
            body: uploadImageBodySchema,
            response: {
              201: z.object({ data: z.object({ id: z.uuid(), contentUrl: z.string() }) }),
              400: errorResponseSchema,
              413: errorResponseSchema,
              422: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 20,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas imagens enviadas. Tente novamente em instantes.' },
            }),
          }),
        },
        async (request, response) => {
          const image = await options.imageServices!.upload(request.body);
          return response.code(201).send({
            data: { id: image.id, contentUrl: `/api/v1/assets/${image.id}/content` },
          });
        },
      );

      app.get(
        '/api/v1/assets/:id/content',
        {
          schema: {
            tags: ['assets'],
            summary: 'Exibe uma imagem armazenada no MinIO',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const image = await options.imageServices!.get({ id: request.params.id });
          if (!image) {
            return response.code(404).send({ error: { code: 'ASSET_NOT_FOUND', message: 'Imagem não encontrada.' } });
          }
          return response
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('content-disposition', 'inline')
            .header('x-content-type-options', 'nosniff')
            .type(image.contentType)
            .send(image.bytes);
        },
      );
    }

    if (options.services) {
    const services = options.services;

    app.get(
      '/api/v1/templates',
      {
        schema: {
          tags: ['templates'],
          summary: 'Lista os modelos ativos',
          response: { 200: z.object({ data: z.array(templateResponseSchema) }) },
        },
      },
      async () => ({
        data: services.listTemplates().map(serializeTemplate),
      }),
    );

    app.get(
      '/api/v1/templates/:id',
      {
        schema: {
          tags: ['templates'],
          summary: 'Recupera a definição da versão ativa de um modelo',
          params: templateIdParamsSchema,
          response: { 200: z.object({ data: templateResponseSchema }), 404: errorResponseSchema },
        },
      },
      async (request) => ({ data: serializeTemplate(services.getTemplate(request.params)) }),
    );

    app.post(
      '/api/v1/templates/:id/validate',
      {
        schema: {
          tags: ['templates'],
          summary: 'Valida dados sem criar um rascunho',
          params: templateIdParamsSchema,
          body: validateTemplateBodySchema,
          response: {
            200: z.object({ data: z.object({ valid: z.literal(true) }) }),
            400: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => ({
        data: services.validateTemplateInput({ templateId: request.params.id, data: request.body.data }),
      }),
    );

    app.post(
      '/api/v1/drafts',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Cria um rascunho anônimo ou vinculado à conta atual',
          body: createDraftBodySchema,
          response: {
            201: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, response) => {
        const user = getAuthenticatedUser(request);
        const draft = services.createDraft({
          ...request.body,
          ...(user ? { ownerUserId: user.id } : {}),
        });
        options.analyticsServices?.recordServerEvent({
          name: 'draft_created',
          entityKey: draft.id,
          draftId: draft.id,
          templateId: draft.templateId,
          ...(user ? { userId: user.id } : {}),
        });
        return response.code(201).send({ data: serializeDraft(draft) });
      },
    );

    app.get(
      '/api/v1/drafts/:id',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Recupera um rascunho',
          params: idParamsSchema,
          response: {
            200: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const user = getAuthenticatedUser(request);
        const adminEmail = getAuthenticatedAdminEmail(request);
        if (user && adminEmail && options.identityServices) {
          const adminPreviewUser = options.identityServices.getAdminTestUser({ email: adminEmail });
          if (adminPreviewUser && adminPreviewUser.id !== user.id) {
            services.transferAdminPreviewDraft({
              id: request.params.id,
              adminPreviewUserId: adminPreviewUser.id,
              customerUserId: user.id,
            });
          }
        }
        return {
          data: serializeDraft(services.getDraft({ ...request.params, ...(user ? { userId: user.id } : {}) })),
        };
      },
    );

    app.put(
      '/api/v1/drafts/:id',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Substitui os dados de um rascunho',
          params: idParamsSchema,
          body: updateDraftBodySchema,
          response: {
            200: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const user = getAuthenticatedUser(request);
        const draft = services.updateDraft({
          ...request.params,
          ...request.body,
          ...(user ? { userId: user.id } : {}),
        });
        options.analyticsServices?.recordServerEvent({
          name: 'draft_updated',
          entityKey: `${draft.id}:${draft.updatedAt.getTime()}:${randomUUID()}`,
          draftId: draft.id,
          templateId: draft.templateId,
          ...(user ? { userId: user.id } : {}),
        });
        return { data: serializeDraft(draft) };
      },
    );
    }

    if (options.demoServices) {
      const demoRateLimit = app.rateLimit({
        max: 12,
        timeWindow: '1 hour',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
        }),
      });
      const demoSlugParamsSchema = z.object({ slug: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

      app.post(
        '/api/v1/demo-publications',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Cria ou atualiza o link temporário de demonstração gratuita por categoria',
            body: createDemoPublicationBodySchema,
            response: {
              200: demoPublicationResponseSchema,
              201: demoPublicationResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              422: errorResponseSchema,
              429: errorResponseSchema,
            },
          },
          preHandler: demoRateLimit,
        },
        async (request, response) => {
          let visitorToken = request.cookies[demoVisitorCookieName];
          if (!visitorToken || !/^[A-Za-z0-9_-]{43}$/.test(visitorToken)) {
            visitorToken = randomBytes(32).toString('base64url');
            response.setCookie(demoVisitorCookieName, visitorToken, {
              httpOnly: true,
              secure: authCookieSecure,
              sameSite: 'lax',
              path: '/',
              maxAge: 90 * 24 * 60 * 60,
            });
          }
          const visitorHash = createHash('sha256').update(visitorToken).digest('hex');
          const user = getAuthenticatedUser(request);
          const publication = options.demoServices!.create({
            draftId: request.body.draftId,
            visitorHash,
            ...(user ? { userId: user.id } : {}),
          });
          const publicPath = `/d/${publication.slug}`;
          const publicUrl = new URL(publicPath, `${publicAppOrigin}/`);
          publicUrl.searchParams.set('v', String(publication.createdAt.getTime()));
          return response.code(publication.created ? 201 : 200).send({
            data: {
              slug: publication.slug,
              publicPath,
              publicUrl: publicUrl.toString(),
              category: publication.category,
              created: publication.created,
              expiresAt: publication.expiresAt.toISOString(),
            },
          });
        },
      );

      app.get(
        '/api/v1/demo-publications/:slug',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Recupera uma demonstração compartilhável ainda válida',
            params: demoSlugParamsSchema,
            response: { 200: publicDemoPublicationResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request) => {
          const publication = options.demoServices!.get(request.params);
          const publicUrl = new URL(`/d/${publication.slug}`, `${publicAppOrigin}/`);
          publicUrl.searchParams.set('v', String(publication.createdAt.getTime()));
          return {
            data: {
              ...publication,
              publicUrl: publicUrl.toString(),
              createdAt: publication.createdAt.toISOString(),
              expiresAt: publication.expiresAt.toISOString(),
            },
          };
        },
      );
    }

    if (options.previewServices) {
      app.get(
        '/api/v1/drafts/:id/preview.png',
        {
          schema: {
            tags: ['drafts'],
            summary: 'Gera uma prévia PNG sem exigir licença',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              429: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 60,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const user = getAuthenticatedUser(request);
          const image = await options.previewServices!.previewDraft({
            draftId: request.params.id,
            ...(user ? { userId: user.id } : {}),
          });
          options.analyticsServices?.recordServerEvent({
            name: 'preview_viewed',
            entityKey: randomUUID(),
            draftId: request.params.id,
            ...(user ? { userId: user.id } : {}),
          });
          return response
            .header('cache-control', 'no-store')
            .header('content-type', 'image/png')
            .send(image);
        },
      );
    }

    if (options.identityServices) {
      const identity = options.identityServices;
      const limitMagicLinkByIp = app.createRateLimit({
        max: 12,
        timeWindow: '15 minutes',
      });
      const limitMagicLinkByEmail = app.createRateLimit({
        max: 3,
        timeWindow: '1 hour',
        keyGenerator: (request) => {
          const body = request.body as { email?: string } | undefined;
          const email = normalizeEmail(body?.email ?? '');
          return `email:${createHash('sha256').update(email).digest('hex')}`;
        },
      });
      const magicLinkRateLimit = async (
        request: FastifyRequest,
        response: FastifyReply,
      ) => {
        const ipLimit = await limitMagicLinkByIp(request);
        const emailLimit =
          !ipLimit.isAllowed && ipLimit.isExceeded
            ? ipLimit
            : await limitMagicLinkByEmail(request);
        if (!emailLimit.isAllowed && emailLimit.isExceeded) {
          return response.code(429).send({
            error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
          });
        }
      };

      app.post(
        '/api/v1/auth/magic-link',
        {
          schema: {
            tags: ['identity'],
            summary: 'Envia um link de acesso por e-mail',
            body: magicLinkBodySchema,
            response: {
              202: authMessageResponseSchema,
              400: errorResponseSchema,
              403: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: magicLinkRateLimit,
        },
        async (request, response) => {
          await identity.requestMagicLink(request.body);
          options.analyticsServices?.recordServerEvent({
            name: 'login_link_requested',
            entityKey: randomUUID(),
          });
          return response.code(202).send({
            data: { message: 'Se o endereço puder receber um link, enviaremos as instruções.' },
          });
        },
      );

      app.post(
        '/api/v1/auth/verify',
        {
          schema: {
            tags: ['identity'],
            summary: 'Consome o link de acesso e cria uma sessão',
            body: verifyMagicLinkBodySchema,
            response: { 200: sessionResponseSchema, 400: errorResponseSchema, 403: errorResponseSchema },
          },
        },
        async (request, response) => {
          const session = await identity.verifyMagicLink(request.body);
          response.setCookie(sessionCookieName, session.token, {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
          });
          return {
            data: {
              user: {
                ...session.user,
                createdAt: session.user.createdAt.toISOString(),
              },
            },
          };
        },
      );

      app.get(
        '/api/v1/auth/session',
        {
          schema: {
            tags: ['identity'],
            summary: 'Consulta a sessão atual',
            response: { 200: sessionResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const token = request.cookies[sessionCookieName];
          const user = token ? identity.getSession({ token }) : undefined;
          if (!user) {
            response.clearCookie(sessionCookieName, { path: '/' });
            return response.code(401).send({
              error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' },
            });
          }
          return { data: { user: { ...user, createdAt: user.createdAt.toISOString() } } };
        },
      );

      app.put(
        '/api/v1/account/profile',
        {
          schema: {
            tags: ['identity'],
            summary: 'Salva os dados do perfil do cliente autenticado',
            body: customerProfileBodySchema,
            response: { 200: sessionResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const updatedUser = identity.updateCustomerProfile({ userId: user.id, ...request.body });
          if (!updatedUser) return response.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' } });
          return {
            data: {
              user: { ...updatedUser, createdAt: updatedUser.createdAt.toISOString() },
            },
          };
        },
      );

      app.delete(
        '/api/v1/auth/session',
        {
          schema: {
            tags: ['identity'],
            summary: 'Encerra a sessão atual',
            response: { 204: z.null(), 403: errorResponseSchema },
          },
        },
        async (request, response) => {
          const token = request.cookies[sessionCookieName];
          if (token) {
            identity.revokeSession({ token });
          }
          response.clearCookie(sessionCookieName, { path: '/' });
          return response.code(204).send(null);
        },
      );
    }

    const adminLoginRateLimit = app.rateLimit({
      max: 5,
      timeWindow: '15 minutes',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
      }),
    });

    app.post(
      '/api/v1/admin/session',
      {
        schema: {
          tags: ['admin'],
          summary: 'Inicia uma sessão administrativa com e-mail e senha',
          body: adminSessionBodySchema,
          response: { 200: adminSessionResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 429: errorResponseSchema, 503: errorResponseSchema },
        },
        preHandler: adminLoginRateLimit,
      },
      async (request, response) => {
        response.header('cache-control', 'no-store');
        if (!options.adminEmail || !options.adminPasswordHash || !options.adminSessionSecret) {
          return response.code(503).send({ error: { code: 'ADMIN_AUTH_UNAVAILABLE', message: 'O acesso administrativo ainda não foi configurado.' } });
        }
        const passwordMatches = await verifyAdminPassword(request.body.password, options.adminPasswordHash);
        if (request.body.email !== options.adminEmail || !passwordMatches) {
          return response.code(401).send({ error: { code: 'INVALID_ADMIN_CREDENTIALS', message: 'E-mail ou senha inválidos.' } });
        }

        const token = createAdminSessionToken({
          email: options.adminEmail,
          secret: `${options.adminSessionSecret}.${options.adminPasswordHash}`,
        });
        response
          .setCookie(adminSessionCookieName, token, {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: 'strict',
            path: '/',
            maxAge: ADMIN_SESSION_TTL_SECONDS,
          });
        return { data: { email: options.adminEmail } };
      },
    );

    app.get(
      '/api/v1/admin/session',
      {
        schema: {
          tags: ['admin'],
          summary: 'Consulta a sessão administrativa atual',
          response: { 200: adminSessionResponseSchema, 401: errorResponseSchema },
        },
      },
      async (request, response) => {
        response.header('cache-control', 'no-store');
        const email = getAuthenticatedAdminEmail(request);
        if (!email) {
          response.clearCookie(adminSessionCookieName, {
            path: '/',
            secure: authCookieSecure,
            httpOnly: true,
            sameSite: 'strict',
          });
          return response.code(401).send({ error: { code: 'ADMIN_AUTH_REQUIRED', message: 'Entre com o acesso administrativo.' } });
        }
        return response.send({ data: { email } });
      },
    );

    app.delete(
      '/api/v1/admin/session',
      {
        schema: {
          tags: ['admin'],
          summary: 'Encerra a sessão administrativa atual',
          response: { 204: z.null() },
        },
      },
      async (_request, response) => {
        response.clearCookie(adminSessionCookieName, {
          path: '/',
          secure: authCookieSecure,
          httpOnly: true,
          sameSite: 'strict',
        });
        return response.code(204).send(null);
      },
    );

    if (options.adminServices) {
      const admin = options.adminServices;
      app.get(
        '/api/v1/admin/access',
        {
          schema: {
            tags: ['admin'],
            summary: 'Indica se a conta atual está autorizada ao painel do criador',
            response: {
              200: z.object({ data: z.object({ allowed: z.boolean() }) }),
              401: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const email = requireAdmin(request, response);
          if (!email) return response;
          return { data: { allowed: true } };
        },
      );

      app.get(
        '/api/v1/admin/users',
        {
          schema: {
            tags: ['admin'],
            summary: 'Busca contas de clientes para suporte',
            querystring: adminUsersQuerySchema,
            response: { 200: adminUsersResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const result = admin.listUsers({
            ...(request.query.q ? { query: request.query.q } : {}),
            limit: request.query.limit,
            offset: request.query.offset,
          });
          return {
            data: {
              total: result.total,
              users: result.users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() })),
            },
          };
        },
      );

      app.post(
        '/api/v1/admin/customers',
        {
          schema: {
            tags: ['admin'],
            summary: 'Cria uma conta de cliente e envia um link de acesso por e-mail',
            body: adminCreateCustomerBodySchema,
            response: {
              201: adminCreateCustomerResponseSchema,
              401: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const actorEmail = requireAdmin(request, response);
          if (!actorEmail) return response;
          if (request.body.email === normalizeEmail(actorEmail)) {
            return response.code(409).send({
              error: { code: 'ADMIN_CUSTOMER_EMAIL_EXISTS', message: 'Esse e-mail já é usado no painel administrativo.' },
            });
          }

          const user = admin.createCustomer({ email: request.body.email, actorEmail });
          if (!user) {
            return response.code(409).send({
              error: { code: 'ADMIN_CUSTOMER_EMAIL_EXISTS', message: 'Já existe uma conta com esse e-mail. Busque-a na lista de clientes.' },
            });
          }

          let accessLinkSent = false;
          if (options.identityServices) {
            try {
              await options.identityServices.requestMagicLink({ email: user.email });
              accessLinkSent = true;
            } catch (error) {
              if (!(error instanceof MagicLinkDeliveryError)) throw error;
            }
          }

          return response.code(201).send({
            data: {
              user: { ...user, createdAt: user.createdAt.toISOString() },
              accessLinkSent,
            },
          });
        },
      );

      app.get(
        '/api/v1/admin/templates',
        {
          schema: {
            tags: ['admin'],
            summary: 'Lista todas as versões de templates para o painel do criador',
            response: { 200: adminTemplatesResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          return { data: admin.listTemplates().map(serializeAdminTemplate) };
        },
      );

      app.post(
        '/api/v1/admin/templates/validate',
        {
          schema: {
            tags: ['admin'],
            summary: 'Valida a definição de um template antes da prévia e publicação',
            body: adminValidateTemplateBodySchema,
            response: { 200: adminTemplateValidationResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          return { data: admin.validateTemplate(request.body) };
        },
      );

      app.post(
        '/api/v1/admin/templates',
        {
          schema: {
            tags: ['admin'],
            summary: 'Cria um rascunho privado de template',
            body: adminCreateTemplateBodySchema,
            response: {
              201: z.object({ data: adminTemplateResponseSchema }),
              400: errorResponseSchema,
              401: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const template = admin.createTemplate(request.body);
          return response.code(201).send({ data: serializeAdminTemplate(template) });
        },
      );

      app.put(
        '/api/v1/admin/templates/:id/versions/:version',
        {
          schema: {
            tags: ['admin'],
            summary: 'Atualiza um rascunho sem alterar versões publicadas',
            params: adminTemplateVersionParamsSchema,
            body: adminUpdateTemplateBodySchema,
            response: { 200: z.object({ data: adminTemplateResponseSchema }), 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const template = admin.updateTemplate({ ...request.params, ...request.body });
          if (!template) {
            return response.code(404).send({ error: { code: 'ADMIN_TEMPLATE_DRAFT_NOT_FOUND', message: 'Esse rascunho não existe ou já foi publicado.' } });
          }
          return { data: serializeAdminTemplate(template) };
        },
      );

      app.post(
        '/api/v1/admin/templates/:id/versions/:version/publish',
        {
          schema: {
            tags: ['admin'],
            summary: 'Publica um rascunho validado no catálogo de clientes',
            params: adminTemplateVersionParamsSchema,
            response: { 200: z.object({ data: adminTemplateResponseSchema }), 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const template = admin.publishTemplate(request.params);
          if (!template) {
            return response.code(404).send({ error: { code: 'ADMIN_TEMPLATE_DRAFT_NOT_FOUND', message: 'Esse rascunho não existe ou já foi publicado.' } });
          }
          return { data: serializeAdminTemplate(template) };
        },
      );

      app.post(
        '/api/v1/admin/templates/:id/archive',
        {
          schema: {
            tags: ['admin'],
            summary: 'Retira a versão ativa do catálogo público',
            params: templateIdParamsSchema,
            response: {
              200: adminArchiveTemplateResponseSchema,
              401: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const changed = admin.archiveTemplate({ id: request.params.id });
          if (!changed) {
            return response.code(404).send({ error: { code: 'TEMPLATE_NOT_FOUND', message: 'Não há uma versão publicada desse template.' } });
          }
          return { data: { changed } };
        },
      );

      app.get(
        '/api/v1/admin/users/:id',
        {
          schema: {
            tags: ['admin'],
            summary: 'Consulta estado de conta, compras e ações de suporte',
            params: idParamsSchema,
            response: { 200: adminUserResponseSchema, 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const result = admin.getUser({ userId: request.params.id });
          if (!result) {
            return response.code(404).send({ error: { code: 'ADMIN_USER_NOT_FOUND', message: 'Cliente não encontrado.' } });
          }
          return {
            data: {
              user: { ...result.user, createdAt: result.user.createdAt.toISOString() },
              purchases: result.purchases.map((purchase) => ({
                ...purchase,
                expiresAt: purchase.expiresAt?.toISOString() ?? null,
                createdAt: purchase.createdAt.toISOString(),
                updatedAt: purchase.updatedAt.toISOString(),
              })),
              platformSales: result.platformSales.map((sale) => ({
                ...sale,
                expiresAt: sale.expiresAt?.toISOString() ?? null,
                createdAt: sale.createdAt.toISOString(),
              })),
              drafts: result.drafts.map((draft) => ({ ...draft, updatedAt: draft.updatedAt.toISOString() })),
              recentActions: result.recentActions.map((action) => ({ ...action, createdAt: action.createdAt.toISOString() })),
            },
          };
        },
      );

      app.post(
        '/api/v1/admin/users/:id/access-link',
        {
          schema: {
            tags: ['admin'],
            summary: 'Reenvia o link de entrada para o e-mail do cliente',
            params: idParamsSchema,
            response: {
              202: authMessageResponseSchema,
              401: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          if (!requireAdmin(request, response)) return response;
          const target = admin.getUser({ userId: request.params.id });
          if (!target) {
            return response.code(404).send({ error: { code: 'ADMIN_USER_NOT_FOUND', message: 'Cliente não encontrado.' } });
          }
          if (target.user.accountStatus !== 'active') {
            return response.code(409).send({ error: { code: 'ADMIN_CUSTOMER_SUSPENDED', message: 'Reative a conta antes de enviar um link de entrada.' } });
          }
          if (!options.identityServices) {
            return response.code(503).send({ error: { code: 'AUTH_UNAVAILABLE', message: 'O envio de links está indisponível.' } });
          }
          await options.identityServices.requestMagicLink({ email: target.user.email });
          return response.code(202).send({
            data: {
              message: 'O servidor de e-mail aceitou o envio. Isso não confirma a entrega; confira a caixa de entrada, Spam e Promoções.',
            },
          });
        },
      );

      app.post(
        '/api/v1/admin/users/:id/platform-sales',
        {
          schema: {
            tags: ['admin'],
            summary: 'Registra uma venda direta e libera o acesso premium da conta do cliente',
            params: idParamsSchema,
            body: adminManualPlatformSaleBodySchema,
            response: {
              201: adminManualPlatformSaleResponseSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const actorEmail = requireAdmin(request, response);
          if (!actorEmail) return response;
          const { confirmPaymentReceived, paymentReference, ...saleInput } = request.body;
          if (confirmPaymentReceived !== true) {
            return response.code(400).send({
              error: { code: 'ADMIN_PAYMENT_CONFIRMATION_REQUIRED', message: 'Confirme o recebimento antes de registrar a venda.' },
            });
          }
          const sale = admin.recordManualPlatformSale({
            ...saleInput,
            userId: request.params.id,
            actorEmail,
            ...(paymentReference !== undefined ? { paymentReference } : {}),
          });
          if (!sale) {
            return response.code(404).send({
              error: { code: 'ADMIN_PLATFORM_SALE_TARGET_NOT_FOUND', message: 'Cliente ativo não encontrado para liberar o acesso.' },
            });
          }
          return response.code(201).send({
            data: {
              saleId: sale.saleId,
              accessStatus: 'active',
              accessPlan: saleInput.plan,
              expiresAt: sale.expiresAt?.toISOString() ?? null,
            },
          });
        },
      );

      app.post(
        '/api/v1/admin/users/:id/manual-sales',
        {
          schema: {
            tags: ['admin'],
            summary: 'Registra um pagamento recebido diretamente e concede acesso ao modelo selecionado',
            params: idParamsSchema,
            body: adminManualPaymentBodySchema,
            response: {
              201: adminManualPaymentResponseSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const actorEmail = requireAdmin(request, response);
          if (!actorEmail) return response;
          const { paymentReference, ...saleInput } = request.body;
          const sale = admin.recordManualPayment({
            ...saleInput,
            userId: request.params.id,
            actorEmail,
            ...(paymentReference !== undefined ? { paymentReference } : {}),
          });
          if (!sale) {
            return response.code(404).send({
              error: {
                code: 'ADMIN_MANUAL_SALE_TARGET_NOT_FOUND',
                message: 'Cliente ativo ou mensagem salva não encontrada para registrar a venda.',
              },
            });
          }
          return response.code(201).send({
            data: {
              purchaseId: sale.purchaseId,
              status: 'paid',
              accessStatus: 'active',
              expiresAt: sale.expiresAt?.toISOString() ?? null,
            },
          });
        },
      );

      app.post(
        '/api/v1/admin/users/:id/status',
        {
          schema: {
            tags: ['admin'],
            summary: 'Suspende ou reativa uma conta de cliente',
            params: idParamsSchema,
            body: adminSetUserStatusBodySchema,
            response: {
              200: adminSetUserStatusResponseSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              409: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const actorEmail = requireAdmin(request, response);
          if (!actorEmail) return response;
          const target = admin.getUser({ userId: request.params.id });
          if (!target) {
            return response.code(404).send({ error: { code: 'ADMIN_USER_NOT_FOUND', message: 'Cliente não encontrado.' } });
          }
          if (target.user.email.trim().toLowerCase() === actorEmail && request.body.status === 'suspended') {
            return response.code(409).send({
              error: { code: 'ADMIN_ACCOUNT_PROTECTED', message: 'Esta conta administrativa não pode ser suspensa por este painel.' },
            });
          }
          const result = admin.setUserStatus({
            userId: request.params.id,
            actorEmail,
            status: request.body.status,
          });
          if (!result) {
            return response.code(404).send({ error: { code: 'ADMIN_USER_NOT_FOUND', message: 'Cliente não encontrado.' } });
          }
          return { data: { status: request.body.status, ...result } };
        },
      );
    }

    if (options.merchantDirectoryServices) {
      const directory = options.merchantDirectoryServices;
      app.get(
        '/api/v1/merchant/customers',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Lista clientes comerciais da conta autenticada',
            querystring: merchantDirectoryListQuerySchema,
            response: { 200: merchantCustomerListResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const customers = directory.listCustomers({
            ownerUserId: user.id,
            ...(request.query.q ? { query: request.query.q } : {}),
            status: request.query.status ?? 'active',
          });
          return { data: customers.map((customer) => ({
            ...customer,
            createdAt: customer.createdAt.toISOString(),
            updatedAt: customer.updatedAt.toISOString(),
          })) };
        },
      );

      app.post(
        '/api/v1/merchant/customers',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Cadastra um cliente comercial',
            body: merchantCustomerBodySchema,
            response: { 201: merchantCustomerResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const customer = directory.createCustomer({ ...request.body, ownerUserId: user.id });
          return response.code(201).send({
            data: { ...customer, createdAt: customer.createdAt.toISOString(), updatedAt: customer.updatedAt.toISOString() },
          });
        },
      );

      app.get(
        '/api/v1/merchant/customers/:id',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Consulta um cliente comercial',
            params: merchantDirectoryIdParamsSchema,
            response: { 200: merchantCustomerResponseEnvelopeSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const customer = directory.getCustomer({ ownerUserId: user.id, id: request.params.id });
          return { data: { ...customer, createdAt: customer.createdAt.toISOString(), updatedAt: customer.updatedAt.toISOString() } };
        },
      );

      app.put(
        '/api/v1/merchant/customers/:id',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Atualiza ou arquiva um cliente comercial',
            params: merchantDirectoryIdParamsSchema,
            body: merchantCustomerUpdateBodySchema,
            response: { 200: merchantCustomerResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const customer = directory.updateCustomer({ ...request.body, ownerUserId: user.id, id: request.params.id });
          return { data: { ...customer, createdAt: customer.createdAt.toISOString(), updatedAt: customer.updatedAt.toISOString() } };
        },
      );

      app.get(
        '/api/v1/merchant/catalog-items',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Lista produtos e serviços cadastrados pela conta',
            querystring: merchantDirectoryListQuerySchema,
            response: { 200: merchantCatalogItemListResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const items = directory.listCatalogItems({
            ownerUserId: user.id,
            ...(request.query.q ? { query: request.query.q } : {}),
            ...(request.query.kind ? { kind: request.query.kind } : {}),
            status: request.query.status ?? 'active',
          });
          return { data: items.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            updatedAt: item.updatedAt.toISOString(),
          })) };
        },
      );

      app.post(
        '/api/v1/merchant/catalog-items',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Cadastra um produto ou serviço',
            body: merchantCatalogItemBodySchema,
            response: { 201: merchantCatalogItemResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const item = directory.createCatalogItem({ ...request.body, ownerUserId: user.id });
          return response.code(201).send({
            data: { ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() },
          });
        },
      );

      app.get(
        '/api/v1/merchant/catalog-items/:id',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Consulta um produto ou serviço',
            params: merchantDirectoryIdParamsSchema,
            response: { 200: merchantCatalogItemResponseEnvelopeSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const item = directory.getCatalogItem({ ownerUserId: user.id, id: request.params.id });
          return { data: { ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() } };
        },
      );

      app.put(
        '/api/v1/merchant/catalog-items/:id',
        {
          schema: {
            tags: ['merchant-directory'],
            summary: 'Atualiza ou arquiva um produto ou serviço',
            params: merchantDirectoryIdParamsSchema,
            body: merchantCatalogItemUpdateBodySchema,
            response: { 200: merchantCatalogItemResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const item = directory.updateCatalogItem({ ...request.body, ownerUserId: user.id, id: request.params.id });
          return { data: { ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() } };
        },
      );
    }

    if (options.merchantLedgerServices) {
      const ledger = options.merchantLedgerServices;
      app.post(
        '/api/v1/merchant/sales',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Registra uma venda e cria os vencimentos correspondentes',
            body: merchantRegisterSaleBodySchema,
            response: { 201: merchantSaleResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const sale = ledger.registerSale({ ...request.body, ownerUserId: user.id });
          return response.code(201).send({ data: presentMerchantSale(sale) });
        },
      );

      app.get(
        '/api/v1/merchant/customers/:id/ledger',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Consulta a caderneta comercial de um cliente',
            params: merchantDirectoryIdParamsSchema,
            response: { 200: merchantCustomerLedgerResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const result = ledger.getCustomerLedger({ ownerUserId: user.id, customerId: request.params.id });
          return {
            data: {
              customer: {
                id: result.customer.id, name: result.customer.name, whatsapp: result.customer.whatsapp,
                email: result.customer.email, address: result.customer.address, notes: result.customer.notes,
                status: result.customer.status,
                createdAt: result.customer.createdAt.toISOString(), updatedAt: result.customer.updatedAt.toISOString(),
              },
              sales: result.sales.map(presentMerchantSale),
            },
          };
        },
      );

      app.post(
        '/api/v1/merchant/installments/:id/payments',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Registra um pagamento integral ou parcial de parcela',
            params: merchantLedgerIdParamsSchema,
            body: merchantPaymentBodySchema,
            response: { 201: merchantPaymentResponseEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const payment = ledger.recordPayment({ ...request.body, ownerUserId: user.id, installmentId: request.params.id });
          return response.code(201).send({ data: presentMerchantPayment(payment) });
        },
      );

      app.get(
        '/api/v1/merchant/installments/:id/message-context',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Preenche uma mensagem com os dados atuais de uma parcela',
            params: merchantLedgerIdParamsSchema,
            response: { 200: merchantChargeMessageContextResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const context = ledger.getMessageContext({ ownerUserId: user.id, installmentId: request.params.id });
          return { data: { ...context, businessName: user.name ?? '', paidAt: null } };
        },
      );

      app.get(
        '/api/v1/merchant/overview',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Resume os compromissos comerciais da conta autenticada',
            response: { 200: merchantLedgerOverviewResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const overview = ledger.getOverview({ ownerUserId: user.id });
          const presentCommitment = (row: typeof overview.dueToday[number]) => ({
            installment: {
              id: row.installment.id, saleId: row.installment.saleId, customerId: row.installment.customerId,
              number: row.installment.number, amountMinor: row.installment.amountMinor, dueDate: row.installment.dueDate,
              status: row.installment.status, paidMinor: row.paidMinor, balanceMinor: row.balanceMinor,
              derivedStatus: row.derivedStatus,
            },
            customer: row.customer,
            saleItems: row.saleItems.map((item) => ({
              id: item.id, kind: item.kind, name: item.name, quantity: item.quantity,
              unitPriceMinor: item.unitPriceMinor, lineTotalMinor: item.lineTotalMinor,
            })),
            payments: row.payments.map(presentMerchantPayment),
          });
          return {
            data: {
              customerCount: overview.customerCount,
              saleCount: overview.saleCount,
              dueToday: overview.dueToday.map(presentCommitment),
              overdue: overview.overdue.map(presentCommitment),
              upcoming: overview.upcoming.map(presentCommitment),
              recentPayments: overview.recentPayments.map(presentMerchantPayment),
            },
          };
        },
      );
    }

    if (options.merchantRecurringServices) {
      const recurring = options.merchantRecurringServices;
      app.get(
        '/api/v1/merchant/recurrences',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Lista planos recorrentes e cobranças geradas',
            querystring: merchantRecurringListQuerySchema,
            response: { 200: merchantRecurringPlansResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          return { data: recurring.listPlans({ ownerUserId: user.id, status: request.query.status ?? 'all' }).map(presentRecurringPlan) };
        },
      );

      app.post(
        '/api/v1/merchant/recurrences',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Cria um plano de cobrança recorrente',
            body: merchantRecurringCreateBodySchema,
            response: { 201: merchantRecurringPlanEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const plan = recurring.createPlan({ ...request.body, ownerUserId: user.id });
          const saved = recurring.listPlans({ ownerUserId: user.id, status: 'all' }).find((item) => item.id === plan.id);
          if (!saved) throw new MerchantLedgerNotFoundError();
          return response.code(201).send({ data: presentRecurringPlan(saved) });
        },
      );

      app.put(
        '/api/v1/merchant/recurrences/:id/rate',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Agenda a alteração do valor de uma recorrência',
            params: merchantRecurringPlanParamsSchema,
            body: merchantRecurringRateBodySchema,
            response: { 200: z.object({ data: z.object({ rates: merchantRecurringPlanResponseSchema.shape.rates }) }), 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const rates = recurring.changeRate({ ...request.body, ownerUserId: user.id, planId: request.params.id });
          return { data: { rates } };
        },
      );

      for (const action of ['pause', 'resume', 'end'] as const) {
        app.post(
          `/api/v1/merchant/recurrences/:id/${action}`,
          {
            schema: {
              tags: ['merchant-recurring'],
              summary: `${action} um plano recorrente`,
              params: merchantRecurringPlanParamsSchema,
              response: { 200: z.object({ data: z.object({ status: merchantRecurringStatusSchema }) }), 401: errorResponseSchema, 404: errorResponseSchema },
            },
          },
          async (request, response) => {
            const user = requireCustomerSession(request, response);
            if (!user) return response;
            recurring[`${action}Plan`]({ ownerUserId: user.id, planId: request.params.id });
            const status: 'active' | 'paused' | 'ended' = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'ended';
            return { data: { status } };
          },
        );
      }

      app.get(
        '/api/v1/merchant/recurring-charges',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Lista cobranças recorrentes com pagamentos e situação atual',
            querystring: merchantRecurringChargesQuerySchema,
            response: { 200: merchantRecurringChargesResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          return { data: recurring.listCharges({
            ownerUserId: user.id,
            ...(request.query.planId ? { planId: request.query.planId } : {}),
            ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
          }).map(presentRecurringCharge) };
        },
      );

      app.post(
        '/api/v1/merchant/recurring-charges/:id/payments',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Registra um pagamento manual de cobrança recorrente',
            params: merchantRecurringPlanParamsSchema,
            body: merchantRecurringPaymentBodySchema,
            response: { 201: merchantRecurringPaymentEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const payment = recurring.recordPayment({ ...request.body, ownerUserId: user.id, chargeId: request.params.id });
          return response.code(201).send({ data: presentRecurringPayment(payment) });
        },
      );

      app.get(
        '/api/v1/merchant/recurring-charges/:id/message-context',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Preenche uma mensagem com os dados atuais de uma cobrança recorrente',
            params: merchantRecurringPlanParamsSchema,
            response: { 200: merchantChargeMessageContextResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const context = recurring.getMessageContext({ ownerUserId: user.id, chargeId: request.params.id });
          return { data: { ...context, businessName: user.name ?? '', paidAt: null } };
        },
      );

      app.get(
        '/api/v1/merchant/recurring-overview',
        {
          schema: {
            tags: ['merchant-recurring'],
            summary: 'Resume compromissos recorrentes próximos e atrasados',
            response: { 200: merchantRecurringOverviewResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const overview = recurring.getOverview({ ownerUserId: user.id });
          return { data: {
            activePlanCount: overview.activePlanCount,
            dueToday: overview.dueToday.map(presentRecurringCharge),
            overdue: overview.overdue.map(presentRecurringCharge),
            upcoming: overview.upcoming.map(presentRecurringCharge),
          } };
        },
      );
    }

    if (options.merchantChargeMessageServices) {
      const chargeMessages = options.merchantChargeMessageServices;
      app.get(
        '/api/v1/merchant/sales/:id/message-context',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Preenche uma mensagem de agradecimento com os dados atuais da venda',
            params: merchantLedgerIdParamsSchema,
            response: { 200: merchantChargeMessageContextResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const context = chargeMessages.getSaleContext({ ownerUserId: user.id, saleId: request.params.id });
          return { data: { ...context, businessName: user.name ?? '' } };
        },
      );

      for (const paymentType of ['sale_payment', 'recurring_payment'] as const) {
        app.get(
          `/api/v1/merchant/${paymentType === 'sale_payment' ? 'sales' : 'recurring-charges'}/payments/:id/message-context`,
          {
            schema: {
              tags: ['merchant-ledger'],
              summary: 'Preenche uma mensagem de pagamento manualmente registrado',
              params: merchantLedgerIdParamsSchema,
              response: { 200: merchantChargeMessageContextResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
            },
          },
          async (request, response) => {
            const user = requireCustomerSession(request, response);
            if (!user) return response;
            const context = chargeMessages.getPaymentContext({ ownerUserId: user.id, paymentType, paymentId: request.params.id });
            return { data: { ...context, businessName: user.name ?? '' } };
          },
        );
      }

      app.post(
        '/api/v1/merchant/charge-messages',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Associa um rascunho a uma cobrança da conta autenticada',
            body: merchantChargeMessageBodySchema,
            response: { 201: merchantChargeMessageEnvelopeSchema, 400: errorResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          const linked = chargeMessages.link({ ...request.body, ownerUserId: user.id });
          return response.code(201).send({ data: {
            id: linked.id, customerId: linked.customerId, sourceType: linked.sourceType, sourceId: linked.sourceId,
            draftId: linked.draftId, createdAt: linked.createdAt.toISOString(),
          } });
        },
      );

      app.get(
        '/api/v1/merchant/customers/:id/charge-messages',
        {
          schema: {
            tags: ['merchant-ledger'],
            summary: 'Lista mensagens de cobrança associadas a um cliente da conta autenticada',
            params: merchantDirectoryIdParamsSchema,
            response: { 200: merchantChargeMessageListResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireCustomerSession(request, response);
          if (!user) return response;
          return { data: chargeMessages.listForCustomer({ ownerUserId: user.id, customerId: request.params.id }).map((message) => ({
            id: message.id, customerId: message.customerId, sourceType: message.sourceType, sourceId: message.sourceId,
            draftId: message.draftId, templateId: message.templateId, templateName: message.templateName,
            createdAt: message.createdAt.toISOString(),
          })) };
        },
      );
    }

    if (options.commerceServices) {
      const commerce = options.commerceServices;
      if (options.identityServices) {
        app.get(
          '/api/v1/customer-portal',
          {
            schema: {
              tags: ['commerce'],
              summary: 'Carrega a área privada do cliente autenticado',
              response: { 200: customerPortalResponseSchema, 401: errorResponseSchema },
            },
          },
          async (request, response) => {
            const user = requireCustomerSession(request, response);
            if (!user) return response;
            const access = commerce.getUserPlatformAccess({ userId: user.id });
            return {
              data: {
                user: { ...user, createdAt: user.createdAt.toISOString() },
                platformAccess: {
                  ...access,
                  expiresAt: access.expiresAt?.toISOString() ?? null,
                },
                accountAccess: commerce.listUserAccess({ userId: user.id }).map((item) => ({
                  ...item,
                  grantedAt: item.grantedAt.toISOString(),
                  expiresAt: item.expiresAt?.toISOString() ?? null,
                })),
                drafts: commerce.listUserDrafts({ userId: user.id }).map((draft) => ({
                  ...draft,
                  updatedAt: draft.updatedAt.toISOString(),
                })),
              },
            };
          },
        );
      }

      app.get(
        '/api/v1/account/access',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Lista compras e licenças da conta atual',
            response: { 200: z.object({ data: z.array(userAccessItemSchema) }), 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          return {
            data: commerce.listUserAccess({ userId: user.id }).map((item) => ({
              ...item,
              grantedAt: item.grantedAt.toISOString(),
              expiresAt: item.expiresAt?.toISOString() ?? null,
            })),
          };
        },
      );

      app.get(
        '/api/v1/account/platform-access',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Consulta se a conta atual tem acesso premium ativo à plataforma',
            response: { 200: z.object({ data: platformAccessSummarySchema }), 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const access = commerce.getUserPlatformAccess({ userId: user.id });
          return {
            data: {
              ...access,
              expiresAt: access.expiresAt?.toISOString() ?? null,
            },
          };
        },
      );

      app.get(
        '/api/v1/purchases/:id',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Consulta o estado de uma compra da conta atual',
            params: idParamsSchema,
            response: {
              200: purchaseStatusResponseSchema,
              401: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const status = commerce.getPurchaseStatus({ purchaseId: request.params.id, userId: user.id });
          return {
            data: {
              ...status,
              expiresAt: status.expiresAt?.toISOString() ?? null,
              updatedAt: status.updatedAt.toISOString(),
            },
          };
        },
      );

      const checkoutRateLimit = app.rateLimit({
        max: 10,
        timeWindow: '1 hour',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
        }),
      });
      app.post(
        '/api/v1/checkout',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Cria uma compra pendente e inicia o checkout hospedado da AbacatePay',
            body: createCheckoutBodySchema,
            response: {
              201: checkoutResponseSchema,
              400: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: checkoutRateLimit,
        },
        async (request, response) => {
          const user = getAuthenticatedUser(request);
          const checkout = await commerce.createCheckout({
            draftId: request.body.draftId,
            ...(request.body.plan ? { plan: request.body.plan } : {}),
            ...(user ? { userId: user.id } : {}),
          });
          const attribution = request.body.attribution;
          const referrerHost = attribution?.referrerUrl
            ? toReferrerHost(attribution.referrerUrl)
            : undefined;
          options.analyticsServices?.recordServerEvent({
            name: 'checkout_started',
            entityKey: checkout.purchaseId,
            purchaseId: checkout.purchaseId,
            draftId: request.body.draftId,
            ...(user ? { userId: user.id } : {}),
            ...(attribution?.source ? { source: attribution.source } : {}),
            ...(attribution?.medium ? { medium: attribution.medium } : {}),
            ...(attribution?.campaign ? { campaign: attribution.campaign } : {}),
            ...(referrerHost ? { referrerHost } : {}),
          });
          return response.code(201).send({ data: checkout });
        },
      );

      app.post(
        '/api/v1/webhooks/cakto',
        {
          config: { rawBody: true },
          bodyLimit: 256 * 1024,
          schema: {
            tags: ['commerce'],
            summary: 'Recebe e persiste um evento assinado da Cakto',
            response: { 202: webhookAcceptedResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!Buffer.isBuffer(request.rawBody)) {
            throw new InvalidCaktoWebhookError();
          }
          const timestamp = request.headers['x-cakto-timestamp'];
          const signature = request.headers['x-cakto-signature'];
          const accepted = commerce.acceptCaktoWebhook({
            rawBody: request.rawBody,
            headers: {
              ...(typeof timestamp === 'string' ? { timestamp } : {}),
              ...(typeof signature === 'string' ? { signature } : {}),
            },
          });
          return response.code(202).send({ data: accepted });
        },
      );

      app.post(
        '/api/v1/webhooks/abacatepay',
        {
          config: { rawBody: true },
          bodyLimit: 256 * 1024,
          schema: {
            tags: ['commerce'],
            summary: 'Valida e persiste um evento assinado da AbacatePay',
            response: {
              202: webhookAcceptedResponseSchema,
              400: errorResponseSchema,
              401: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          if (!Buffer.isBuffer(request.rawBody)) {
            throw new InvalidAbacatePayWebhookPayloadError();
          }
          const secret = request.headers['x-webhook-secret'];
          const signature = request.headers['x-webhook-signature'];
          const requestUrl = new URL(request.url, 'http://localhost');
          const querySecret = requestUrl.searchParams.get('webhookSecret') ?? undefined;
          const accepted = commerce.acceptAbacatePayWebhook({
            rawBody: request.rawBody,
            headers: {
              ...(typeof secret === 'string' ? { secret } : {}),
              ...(querySecret ? { querySecret } : {}),
              ...(typeof signature === 'string' ? { signature } : {}),
            },
          });
          return response.code(202).send({ data: accepted });
        },
      );
    }

    if (options.publishingServices) {
      const publishing = options.publishingServices;
      const slugParamsSchema = z.object({ slug: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

      app.post(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Publica ou atualiza o link público de um rascunho',
            params: idParamsSchema,
            response: {
              200: publicationResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const publication = publishing.publish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_published',
            entityKey: `${publication.id}:${publication.publishedAt.getTime()}`,
            publicationId: publication.id,
            draftId: publication.draftId,
            userId: user.id,
          });
          return response.code(200).send({
            data: {
              slug: publication.slug,
              status: 'published' as const,
              publicPath: `/p/${publication.slug}`,
              publicUrl: new URL(`/p/${publication.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: publication.publishedAt.toISOString(),
            },
          });
        },
      );

      app.put(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Atualiza e mantém publicado o link público de um rascunho',
            params: idParamsSchema,
            response: {
              200: publicationResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const publication = publishing.publish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_published',
            entityKey: `${publication.id}:${publication.publishedAt.getTime()}`,
            publicationId: publication.id,
            draftId: publication.draftId,
            userId: user.id,
          });
          return response.code(200).send({
            data: {
              slug: publication.slug,
              status: 'published' as const,
              publicPath: `/p/${publication.slug}`,
              publicUrl: new URL(`/p/${publication.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: publication.publishedAt.toISOString(),
            },
          });
        },
      );

      app.delete(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Remove o link público de um rascunho',
            params: idParamsSchema,
            response: { 204: z.null(), 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          publishing.unpublish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_unpublished',
            entityKey: `${request.params.id}:${randomUUID()}`,
            draftId: request.params.id,
            userId: user.id,
          });
          return response.code(204).send(null);
        },
      );

      app.get(
        '/api/v1/publications/:slug',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Recupera uma publicação pública ainda licenciada',
            params: slugParamsSchema,
            response: { 200: publicMessageResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const message = publishing.getPublicMessage(request.params);
          if (!message) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          return {
            data: {
              ...message,
              publicUrl: new URL(`/p/${request.params.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: message.publishedAt.toISOString(),
            },
          };
        },
      );

      app.get(
        '/api/v1/publications/:slug.png',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Renderiza uma publicação pública como PNG',
            params: slugParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              429: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 120,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const image = await publishing.renderPublicMessagePng(request.params);
          if (!image) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          return response
            .header('cache-control', 'no-store')
            .header('content-type', 'image/png')
            .send(image);
        },
      );

      app.get(
        '/p/:slug',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Abre uma página pública para compartilhar o cartão',
            params: slugParamsSchema,
            response: { 200: z.string(), 404: errorResponseSchema, 429: errorResponseSchema },
          },
          preHandler: app.rateLimit({
            max: 120,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const message = publishing.getPublicMessage(request.params);
          if (!message) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          const publicUrl = new URL(`/p/${request.params.slug}`, `${publicAppOrigin}/`).toString();
          const imageUrl = new URL(
            `/api/v1/publications/${request.params.slug}.png`,
            `${publicApiOrigin}/`,
          ).toString();
          const businessName = resolveTemplateBusinessName(message.templateDefinition, message.data);
          const title = `${message.templateName} · Cadernô`;
          const description = businessName
            ? `Cartão digital de ${businessName}, criado com o Cadernô Express. Confira o conteúdo e valide os dados antes de pagar.`
            : `Você recebeu um cartão digital criado com o Cadernô Express. Se houver cobrança, confira o recebedor e o valor antes de pagar.`;
          const safeTitle = escapeHtmlAttribute(title);
          const safeDescription = escapeHtmlAttribute(description);
          const safePublicUrl = escapeHtmlAttribute(publicUrl);
          const safeImageUrl = escapeHtmlAttribute(imageUrl);
          const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Cadernô Express">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:url" content="${safePublicUrl}">
    <meta property="og:image" content="${safeImageUrl}">
    <meta property="og:image:secure_url" content="${safeImageUrl}">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${safeImageUrl}">
  </head>
  <body><main><img src="${safeImageUrl}" alt="Mensagem compartilhada"></main></body>
</html>`;
          return response
            .header('cache-control', 'no-store')
            .header('content-security-policy', "default-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            .header('x-content-type-options', 'nosniff')
            .type('text/html; charset=utf-8')
            .send(html);
        },
      );

      app.get(
        '/api/v1/drafts/:id/export.png',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Exporta um rascunho como PNG',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              422: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const image = await publishing.exportMessage({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'export_generated',
            entityKey: randomUUID(),
            draftId: request.params.id,
            userId: user.id,
          });
          return response
            .header('content-type', 'image/png')
            .header('content-disposition', `attachment; filename="caderno-${request.params.id}.png"`)
            .send(image);
        },
      );
    }

    app.post(
      '/api/v1/analytics/events',
      {
        schema: {
          tags: ['analytics'],
          summary: 'Registra um evento não financeiro do funil',
          body: analyticsEventBodySchema,
          response: {
            202: z.object({ data: z.object({ accepted: z.boolean() }) }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            429: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
        preHandler: app.rateLimit({
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
          }),
        }),
      },
      async (request, response) => {
        if (!options.analyticsServices) {
          return response.code(503).send({
            error: { code: 'ANALYTICS_UNAVAILABLE', message: 'O registro de eventos está indisponível.' },
          });
        }
        const user = getAuthenticatedUser(request);
        const body = request.body;
        const result = options.analyticsServices.trackClientEvent({
          eventId: body.eventId,
          name: body.name,
          ...(body.draftId ? { draftId: body.draftId } : {}),
          ...(body.templateId ? { templateId: body.templateId } : {}),
          ...(body.source ? { source: body.source } : {}),
          ...(body.medium ? { medium: body.medium } : {}),
          ...(body.campaign ? { campaign: body.campaign } : {}),
          ...(body.referrerUrl ? { referrerUrl: body.referrerUrl } : {}),
          ...(user ? { userId: user.id } : {}),
        });
        return response.code(202).send({ data: result });
      },
    );

    app.get(
      '/api/v1/analytics/summary',
      {
        schema: {
          tags: ['analytics'],
          summary: 'Consulta métricas agregadas do funil',
          querystring: analyticsSummaryQuerySchema,
          response: {
            200: analyticsSummaryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, response) => {
        if (!options.analyticsServices || !options.analyticsReadToken) {
          return response.code(503).send({
            error: { code: 'ANALYTICS_UNAVAILABLE', message: 'A consulta de métricas não está configurada.' },
          });
        }
        if (!bearerTokenMatches(request.headers.authorization, options.analyticsReadToken)) {
          return response.code(401).send({
            error: { code: 'ANALYTICS_UNAUTHORIZED', message: 'A credencial de consulta é inválida.' },
          });
        }
        const summary = options.analyticsServices.getSummary({
          from: new Date(request.query.from),
          to: new Date(request.query.to),
        });
        return { data: summary };
      },
    );

    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  });

  return app;
}

function serializeDraft(draft: Draft) {
  return {
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

function serializeTemplate(template: ReturnType<ApplicationServices['getTemplate']>) {
  return {
    id: template.id,
    version: template.version,
    name: template.name,
    description: template.description,
    definition: template.definition,
    createdAt: template.createdAt.toISOString(),
  };
}

function serializeAdminTemplate(template: ReturnType<AdminServices['listTemplates']>[number]) {
  return { ...template, createdAt: template.createdAt.toISOString() };
}

function bearerTokenMatches(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function toReferrerHost(referrerUrl: string): string | undefined {
  try {
    const url = new URL(referrerUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.slice(0, 253).toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
