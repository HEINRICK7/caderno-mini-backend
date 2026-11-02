import { createHash, randomUUID } from 'node:crypto';

import type { IncomingCaktoEvent, NewWebhookEvent, WebhookEvent } from '../dto/payment-event.js';
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
  events: IncomingCaktoEvent[],
  dependencies: Pick<CaktoWebhookDependencies, 'inbox' | 'generateId' | 'clock'>,
): { accepted: number; duplicates: number } {
  const now = dependencies.clock?.() ?? new Date();
  const generateId = dependencies.generateId ?? randomUUID;
  const rows: NewWebhookEvent[] = events.map((event) => ({
    id: generateId(),
    dedupeKey: event.dedupeKey,
    eventType: event.eventType,
    providerOrderId: event.providerOrderId ?? null,
    providerStatus: event.providerStatus ?? null,
    callbackHash: event.callbackToken ? hashToken(event.callbackToken) : null,
    // Keep the e-mail only until an approved purchase is processed and linked to its license.
    customerEmail: event.eventType === 'purchase_approved' ? event.customerEmail ?? null : null,
    productId: event.productId ?? null,
    offerId: event.offerId ?? null,
    offerType: event.offerType ?? null,
    amountMinor: event.amountMinor ?? null,
    currency: event.currency ?? null,
    occurredAt: event.occurredAt ?? null,
    receivedAt: now,
  }));
  const accepted = dependencies.inbox.insert(rows);
  return { accepted, duplicates: events.length - accepted };
}

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

function processPurchaseEvent(
  event: WebhookEvent,
  dependencies: CaktoWebhookDependencies,
  expectedProductIds: readonly string[],
  now: Date,
): void {
  if (!event.providerOrderId || !event.productId || !expectedProductIds.includes(event.productId) || event.offerType !== 'main') {
    return;
  }

  const purchase = dependencies.purchases.findForWebhook(event.callbackHash, event.providerOrderId);
  if (!purchase || (purchase.providerOrderId && purchase.providerOrderId !== event.providerOrderId)) {
    return;
  }

  const signal = signalFor(event.eventType, event.providerStatus);
  const transition = transitionPurchase(purchase.status, signal);
  const update = {
    purchaseId: purchase.id,
    status: transition.status,
    providerOrderId: event.providerOrderId,
    revokeAccess: transition.revokeAccess,
    now,
    ...(event.customerEmail ? { customerEmail: event.customerEmail } : {}),
    ...(transition.grantAccess && event.customerEmail
      ? {
          grantEmail: event.customerEmail,
          accessExpiresAt: licenseExpiresAt(dependencies.productPlans?.[event.productId], now),
        }
      : {}),
  };
  dependencies.purchases.applyWebhookUpdate(update);
  if (transition.status === 'paid' && dependencies.analytics) {
    dependencies.analytics.record({
      id: randomUUID(),
      dedupeKey: `server:purchase_paid:${purchase.id}`,
      name: 'purchase_paid',
      purchaseId: purchase.id,
      draftId: purchase.draftId,
      occurredAt: now,
    });
  }
}

function licenseExpiresAt(plan: AccessPlan | undefined, grantedAt: Date): Date | null {
  if (plan !== 'annual' && plan !== 'lifetime') return null;
  return accessExpiresAt(plan, grantedAt);
}

function signalFor(eventType: string, providerStatus: string | null): PaymentSignal {
  if (eventType === 'purchase_approved' && providerStatus === 'paid') {
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
  if (eventType.endsWith('_gerado') && providerStatus === 'waiting_payment') {
    return 'pending';
  }
  return 'other';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
