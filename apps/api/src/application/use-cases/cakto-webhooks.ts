import { createHash, randomUUID } from 'node:crypto';

import type { IncomingPaymentEvent, NewWebhookEvent, WebhookEvent } from '../dto/payment-event.js';
import type { PurchaseRepository } from '../ports/purchase-repository.js';
import type { WebhookInboxRepository } from '../ports/webhook-inbox-repository.js';
import type { AnalyticsRepository } from '../ports/analytics-repository.js';
import { accessExpiresAt, transitionPurchase, type AccessPlan, type PaymentSignal } from '../../domain/commerce/purchase.js';

export type CaktoWebhookDependencies = {
  inbox: WebhookInboxRepository;
  purchases: PurchaseRepository;
  analytics?: AnalyticsRepository;
  expectedProductId?: string;
  expectedProductIds?: readonly string[];
  productPlans?: Readonly<Record<string, AccessPlan>>;
  generateId?: () => string;
  clock?: () => Date;
};

export function persistCaktoEvents(
  events: IncomingPaymentEvent[],
  dependencies: Pick<CaktoWebhookDependencies, 'inbox' | 'generateId' | 'clock'>,
): { accepted: number; duplicates: number } {
  const now = dependencies.clock?.() ?? new Date();
  const generateId = dependencies.generateId ?? randomUUID;
  const rows: NewWebhookEvent[] = events.map((event) => ({
    id: generateId(),
    dedupeKey: event.dedupeKey,
    sideEffectDedupeKey: event.sideEffectDedupeKey ?? null,
    eventType: event.eventType,
    providerOrderId: event.providerOrderId ?? null,
    providerStatus: event.providerStatus ?? null,
    callbackHash: event.callbackToken ? hashToken(event.callbackToken) : null,
    // Keep the e-mail only until an approved purchase is processed and linked to its license.
    customerEmail: ['purchase_approved', 'subscription_approved', 'subscription_renewed'].includes(event.eventType)
      ? event.customerEmail ?? null
      : null,
    productId: event.productId ?? null,
    offerId: event.offerId ?? null,
    offerType: event.offerType ?? null,
    planFrequency: event.planFrequency ?? null,
    amountMinor: event.amountMinor ?? null,
    currency: event.currency ?? null,
    occurredAt: event.occurredAt ?? null,
    receivedAt: now,
  }));
  const accepted = dependencies.inbox.insert(rows);
  return { accepted, duplicates: events.length - accepted };
}

export const persistPaymentEvents = persistCaktoEvents;

export function processCaktoInboxBatch(
  dependencies: CaktoWebhookDependencies,
  limit = 25,
): number {
  const expectedProductIds = dependencies.expectedProductIds
    ?? (dependencies.expectedProductId ? [dependencies.expectedProductId] : []);
  if (expectedProductIds.length === 0) {
    return 0;
  }

  const now = dependencies.clock?.() ?? new Date();
  const events = dependencies.inbox.claimPending(limit, now);
  let processed = 0;

  for (const event of events) {
    try {
      processPurchaseEvent(event, dependencies, expectedProductIds, now);
      dependencies.inbox.markProcessed(event.id, now);
      processed += 1;
    } catch {
      dependencies.inbox.markFailed(event.id, event.attemptCount, 'PROCESSING_FAILED');
    }
  }

  return processed;
}

export const processPaymentInboxBatch = processCaktoInboxBatch;

function processPurchaseEvent(
  event: WebhookEvent,
  dependencies: CaktoWebhookDependencies,
  expectedProductIds: readonly string[],
  now: Date,
): void {
  const isConfiguredProduct = Boolean(event.productId && expectedProductIds.includes(event.productId));
  const isSinglePayment = event.offerType === 'main';
  const isAnnualSubscription = event.offerType === 'subscription' &&
    event.planFrequency === 'ANNUALLY' &&
    dependencies.productPlans?.[event.productId ?? ''] === 'annual';
  if (!event.providerOrderId || !event.productId || !isConfiguredProduct || (!isSinglePayment && !isAnnualSubscription)) return;

  const purchase = dependencies.purchases.findForWebhook(event.callbackHash, event.providerOrderId);
  if (!purchase || (purchase.providerOrderId && purchase.providerOrderId !== event.providerOrderId)) {
    return;
  }

  const signal = signalFor(event.eventType, event.providerStatus);
  const transition = transitionPurchase(purchase.status, signal);
  const extendAnnualAccess = event.eventType === 'subscription_renewed' &&
    signal === 'approved' && purchase.status === 'paid';
  const grantAccess = transition.grantAccess || extendAnnualAccess;
  const accessEffectiveAt = event.occurredAt ? new Date(event.occurredAt) : now;
  const update = {
    purchaseId: purchase.id,
    ...(event.sideEffectDedupeKey ? { sideEffectDedupeKey: event.sideEffectDedupeKey } : {}),
    status: transition.status,
    providerOrderId: event.providerOrderId,
    revokeAccess: transition.revokeAccess,
    now,
    ...(grantAccess ? { accessEffectiveAt } : {}),
    ...(event.customerEmail ? { customerEmail: event.customerEmail } : {}),
    ...(transition.status === 'paid' && typeof event.amountMinor === 'number' && event.amountMinor > 0
      ? { amountMinor: event.amountMinor }
      : {}),
    ...(transition.status === 'paid' && event.currency && /^[A-Z]{3}$/.test(event.currency.toUpperCase())
      ? { currency: event.currency.toUpperCase() }
      : {}),
    grantAccess,
    ...(extendAnnualAccess ? { extendAnnualAccess: true } : {}),
    ...(grantAccess ? {
      ...(event.customerEmail ? { grantEmail: event.customerEmail } : {}),
      accessExpiresAt: licenseExpiresAt(
        event.offerType === 'subscription' ? 'annual' : dependencies.productPlans?.[event.productId],
        accessEffectiveAt,
      ),
    } : {}),
  };
  dependencies.purchases.applyWebhookUpdate(update);
  if (transition.status === 'paid' && dependencies.analytics) {
    dependencies.analytics.record({
      id: randomUUID(),
      dedupeKey: `server:purchase_paid:${purchase.id}`,
      name: 'purchase_paid',
      purchaseId: purchase.id,
      ...(purchase.draftId ? { draftId: purchase.draftId } : {}),
      occurredAt: accessEffectiveAt,
    });
  }
}

function licenseExpiresAt(plan: AccessPlan | undefined, grantedAt: Date): Date | null {
  if (plan !== 'annual' && plan !== 'lifetime') return null;
  return accessExpiresAt(plan, grantedAt);
}

function signalFor(eventType: string, providerStatus: string | null): PaymentSignal {
  if (['purchase_approved', 'subscription_approved', 'subscription_renewed'].includes(eventType) &&
    ['paid', 'approved'].includes(providerStatus ?? '')) {
    return 'approved';
  }
  if (eventType === 'purchase_refused' && providerStatus === 'refused') {
    return 'refused';
  }
  if (eventType === 'refund' && providerStatus === 'refunded') {
    return 'refunded';
  }
  if (eventType === 'chargeback' && ['chargedback', 'MED', 'prechargeback'].includes(providerStatus ?? '')) {
    return 'chargeback';
  }
  if (eventType === 'refund_requested') {
    return 'refund_requested';
  }
  if (eventType === 'subscription_cancelled' && providerStatus === 'NOW') {
    return 'canceled';
  }
  if (eventType.endsWith('_gerado') && providerStatus === 'waiting_payment') {
    return 'pending';
  }
  return 'other';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
