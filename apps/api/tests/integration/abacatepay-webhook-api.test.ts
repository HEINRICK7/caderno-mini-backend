import { createHash, createHmac, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import { accessGrants, drafts, purchases, templates, users, webhookEventEffects, webhookEvents } from '../../src/infrastructure/database/schema.js';

const secret = 'test-abacatepay-webhook-secret-with-at-least-32-chars';
const signatureKey = 'test-public-signature-key';
const abacatePay = {
  apiKey: 'test-abacatepay-api-key',
  webhookSecret: secret,
  signatureKey,
  plans: {
    annual: { productId: 'annual-product' },
    lifetime: { productId: 'lifetime-product' },
  },
  publicAppUrl: 'https://app.example.test',
};

describe('AbacatePay webhook API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('rejects invalid authentication and malformed documented envelopes without persisting them', async () => {
    const { app, database } = await createTestApp(':memory:', { abacatePay });
    close = async () => { await app.close(); database.close(); };
    const body = JSON.stringify({ id: 'log-1', event: 'checkout.completed', apiVersion: 2, data: {} });

    const noSecret = await deliver(app, body, { querySecret: '', headerSecret: '' });
    const wrongSignature = await deliver(app, body, { signature: 'invalid' });
    const invalidEnvelope = await deliver(app, JSON.stringify({ id: 'log-2', event: 'checkout.completed', apiVersion: 2, data: { checkout: {} } }));

    expect(noSecret.statusCode).toBe(401);
    expect(wrongSignature.statusCode).toBe(401);
    expect(invalidEnvelope.statusCode).toBe(400);
    expect(database.db.select().from(webhookEvents).all()).toHaveLength(0);
  });

  it('stores each delivery, deduplicates automatic and manual retries, and associates the checkout only by its internal callback', async () => {
    const { app, database, commerceServices } = await createTestApp(':memory:', { abacatePay });
    close = async () => { await app.close(); database.close(); };
    const { callback } = createPendingPurchase(database.db, undefined, 'valid-internal-callback');
    const event = checkoutEvent('log-delivery-1', callback, 'bill-valid');
    const first = await deliver(app, JSON.stringify(event));
    expect(first.statusCode).toBe(202);
    expect(first.json().data).toEqual({ accepted: 1, duplicates: 0 });
    commerceServices.processPaymentInboxBatch();

    const grantBeforeRetry = database.db.select().from(accessGrants).get();
    expect(grantBeforeRetry?.status).toBe('active');
    expect(database.db.select().from(purchases).get()?.status).toBe('paid');

    const automaticRetry = await deliver(app, JSON.stringify(event));
    expect(automaticRetry.json().data).toEqual({ accepted: 0, duplicates: 1 });

    const manualRetry = await deliver(app, JSON.stringify(checkoutEvent('log-delivery-2', callback, 'bill-valid')));
    expect(manualRetry.json().data).toEqual({ accepted: 1, duplicates: 0 });
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(accessGrants).get()?.expiresAt?.getTime())
      .toBe(grantBeforeRetry?.expiresAt?.getTime());
    expect(database.db.select().from(webhookEvents).all()).toHaveLength(2);
    expect(database.db.select().from(webhookEventEffects).all()).toHaveLength(1);

    const wrongCallbackForKnownCheckout = await deliver(
      app,
      JSON.stringify(checkoutEvent('log-delivery-wrong-callback', 'not-our-callback', 'bill-valid')),
    );
    expect(wrongCallbackForKnownCheckout.statusCode).toBe(202);
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(purchases).get()?.providerOrderId).toBe('bill-valid');
    expect(database.db.select().from(accessGrants).all()).toHaveLength(1);

    const spoofedAssociation = await deliver(app, JSON.stringify(checkoutEvent('log-delivery-3', 'not-our-callback', 'bill-other')));
    expect(spoofedAssociation.statusCode).toBe(202);
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(purchases).get()?.providerOrderId).toBe('bill-valid');
    expect(database.db.select().from(accessGrants).all()).toHaveLength(1);
  });

  it('grants an annual subscription to the internally linked user, extends once per payment, and leaves access intact on a failed payment', async () => {
    const { app, database, commerceServices } = await createTestApp(':memory:', { abacatePay });
    close = async () => { await app.close(); database.close(); };
    const ownerUserId = randomUUID();
    database.db.insert(users).values({
      id: ownerUserId,
      email: 'owner@example.test',
      accountStatus: 'active',
      emailVerifiedAt: new Date(),
      createdAt: new Date(),
    }).run();
    const { callback } = createPendingPurchase(database.db, ownerUserId, 'subscription-callback');

    const completed = subscriptionEvent('log-subscription-1', 'subscription.completed', callback, 'payment-initial');
    expect((await deliver(app, JSON.stringify(completed))).statusCode).toBe(202);
    commerceServices.processPaymentInboxBatch();
    const initialGrant = database.db.select().from(accessGrants).get();
    expect(initialGrant?.userId).toBe(ownerUserId);
    expect(initialGrant?.status).toBe('active');
    expect(initialGrant?.expiresAt).toBeInstanceOf(Date);

    const renewed = subscriptionEvent('log-subscription-2', 'subscription.renewed', callback, 'payment-renewal-1');
    await deliver(app, JSON.stringify(renewed));
    commerceServices.processPaymentInboxBatch();
    const renewedExpiry = database.db.select().from(accessGrants).get()?.expiresAt?.getTime();
    expect(renewedExpiry).toBeGreaterThan(initialGrant!.expiresAt!.getTime());

    await deliver(app, JSON.stringify(subscriptionEvent('log-subscription-3', 'subscription.renewed', callback, 'payment-renewal-1')));
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(accessGrants).get()?.expiresAt?.getTime()).toBe(renewedExpiry);

    const failed = subscriptionEvent('log-subscription-4', 'subscription.payment_failed', callback, 'payment-failed-1');
    await deliver(app, JSON.stringify(failed));
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(accessGrants).get()?.status).toBe('active');
    expect(database.db.select().from(purchases).get()?.status).toBe('paid');

    const nextCycleCancellation = subscriptionEvent(
      'log-subscription-5', 'subscription.cancelled', callback, 'payment-cancel-next-cycle', 'NEXT_CYCLE',
    );
    await deliver(app, JSON.stringify(nextCycleCancellation));
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(accessGrants).get()?.status).toBe('active');
    expect(database.db.select().from(purchases).get()?.status).toBe('paid');

    const immediateCancellation = subscriptionEvent(
      'log-subscription-6', 'subscription.cancelled', callback, 'payment-cancel-now', 'NOW',
    );
    await deliver(app, JSON.stringify(immediateCancellation));
    commerceServices.processPaymentInboxBatch();
    expect(database.db.select().from(accessGrants).get()?.status).toBe('revoked');
    expect(database.db.select().from(purchases).get()?.status).toBe('canceled');

    const latePaymentOrder = createPendingPurchase(database.db, ownerUserId, 'late-payment-callback');
    await deliver(app, JSON.stringify(subscriptionEvent(
      'log-subscription-7', 'subscription.cancelled', latePaymentOrder.callback,
      'payment-cancel-before-payment', 'NOW', 'subs_late',
    )));
    commerceServices.processPaymentInboxBatch();
    await deliver(app, JSON.stringify(subscriptionEvent(
      'log-subscription-8', 'subscription.completed', latePaymentOrder.callback,
      'payment-late', null, 'subs_late',
    )));
    commerceServices.processPaymentInboxBatch();
    const canceledBeforePayment = database.db.select().from(purchases)
      .where(eq(purchases.id, latePaymentOrder.purchaseId)).get();
    expect(canceledBeforePayment?.status).toBe('canceled');
    expect(database.db.select().from(accessGrants).all()).toHaveLength(1);
  });
});

function createPendingPurchase(db: Parameters<typeof insertTemplate>[0], ownerUserId?: string, callback = 'opaque-callback') {
  if (!db.select().from(templates).where(eq(templates.id, 'mensagem-exemplo')).get()) insertTemplate(db);
  const draftId = randomUUID();
  const now = new Date();
  db.insert(drafts).values({
    id: draftId,
    templateId: 'mensagem-exemplo',
    templateVersion: 1,
    data: { message: 'Mensagem' },
    ownerUserId: ownerUserId ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  const purchaseId = randomUUID();
  db.insert(purchases).values({
    id: purchaseId,
    draftId,
    ownerUserId: ownerUserId ?? null,
    callbackHash: createHash('sha256').update(callback).digest('hex'),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }).run();
  return { draftId, purchaseId, callback };
}

function checkoutEvent(id: string, externalId: string, checkoutId: string) {
  return {
    id,
    event: 'checkout.completed',
    apiVersion: 2,
    devMode: true,
    data: {
      checkout: {
        id: checkoutId,
        externalId,
        amount: 9900,
        paidAmount: 9900,
        items: [{ id: 'annual-product', quantity: 1 }],
        status: 'PAID',
        frequency: 'ONE_TIME',
        createdAt: '2026-10-12T18:56:15.538Z',
        updatedAt: '2026-10-12T18:58:20.104Z',
      },
      customer: { id: 'cust_test', name: 'Comprador', email: 'buyer@example.test', taxId: null },
      payerInformation: { method: 'PIX' },
    },
  };
}

function subscriptionEvent(
  id: string,
  event: string,
  externalId: string,
  paymentId: string,
  cancelPolicy: string | null = null,
  subscriptionId = 'subs_test',
) {
  return {
    id,
    event,
    apiVersion: 2,
    devMode: true,
    data: {
      subscription: {
        id: subscriptionId,
        status: event === 'subscription.cancelled' ? 'CANCELLED' : 'ACTIVE',
        frequency: 'ANNUALLY',
        cancelPolicy: event === 'subscription.cancelled' ? cancelPolicy : null,
        updatedAt: new Date().toISOString(),
      },
      checkout: {
        id: `bill_${subscriptionId}`,
        externalId,
        amount: 9900,
        paidAmount: 9900,
        items: [{ id: 'annual-product', quantity: 1 }],
        status: 'PAID',
        frequency: 'SUBSCRIPTION',
        updatedAt: new Date().toISOString(),
      },
      payment: {
        id: paymentId,
        amount: event === 'subscription.payment_failed' ? 9900 : 9900,
        paidAmount: 9900,
        status: event === 'subscription.payment_failed' ? 'FAILED' : 'APPROVED',
        updatedAt: new Date().toISOString(),
      },
      customer: { id: 'cust_test', name: 'Comprador', email: null, taxId: null },
    },
  };
}

async function deliver(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  rawBody: string,
  overrides: { querySecret?: string; headerSecret?: string; signature?: string } = {},
) {
  const signature = overrides.signature ?? createHmac('sha256', signatureKey).update(rawBody).digest('base64');
  const querySecret = overrides.querySecret ?? secret;
  const headerSecret = overrides.headerSecret ?? secret;
  return app.inject({
    method: 'POST',
    url: `/api/v1/webhooks/abacatepay?webhookSecret=${encodeURIComponent(querySecret)}`,
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': headerSecret,
      'x-webhook-signature': signature,
    },
    payload: rawBody,
  });
}
