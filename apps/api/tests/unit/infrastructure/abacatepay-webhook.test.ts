import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  InvalidAbacatePayWebhookPayloadError,
  UnauthorizedAbacatePayWebhookError,
} from '../../../src/application/errors.js';
import { parseAbacatePayWebhook } from '../../../src/infrastructure/payments/abacatepay/webhook.js';

const secret = 'abacatepay-webhook-secret-for-tests-0123456789';
const signatureKey = 'test-public-signature-key';

describe('parseAbacatePayWebhook', () => {
  it.each([
    ['checkout.completed', { checkout: { id: 'bill_one', externalId: 'opaque-callback', frequency: 'ONE_TIME', status: 'PAID', paidAmount: 990, items: [{ id: 'annual-product' }] }, customer: { email: 'buyer@example.com' } }, 'purchase_approved'],
    ['checkout.refunded', { checkout: { id: 'bill_one', externalId: 'opaque-callback', status: 'REFUNDED', items: [{ id: 'annual-product' }] } }, 'refund'],
    ['checkout.disputed', { checkout: { id: 'bill_one', externalId: 'opaque-callback', status: 'UNDER_DISPUTE', items: [{ id: 'annual-product' }] } }, 'refund_requested'],
    ['checkout.lost', { checkout: { id: 'bill_one', externalId: 'opaque-callback', status: 'REFUNDED', items: [{ id: 'annual-product' }] } }, 'chargeback'],
    ['subscription.completed', { subscription: { id: 'subs_1', status: 'ACTIVE', frequency: 'ANNUALLY' }, checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] }, payment: { id: 'payment_1', status: 'APPROVED', amount: 9900 } }, 'subscription_approved'],
    ['subscription.renewed', { subscription: { id: 'subs_1', status: 'ACTIVE', frequency: 'ANNUALLY' }, checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] }, payment: { id: 'payment_2', status: 'PAID', amount: 9900 } }, 'subscription_renewed'],
    ['subscription.cancelled', { subscription: { id: 'subs_1', status: 'CANCELLED', frequency: 'ANNUALLY', cancelPolicy: 'NOW' }, checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] } }, 'subscription_cancelled'],
    ['subscription.payment_failed', { subscription: { id: 'subs_1', status: 'ACTIVE', frequency: 'ANNUALLY' }, checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] }, payment: { id: 'payment_failed_1', status: 'FAILED', amount: 9900 } }, 'subscription_payment_failed'],
  ])('normalizes the documented %s event', (event, data, expectedType) => {
    const rawBody = Buffer.from(JSON.stringify({ id: `log-${event}`, event, apiVersion: 2, devMode: true, data }));
    const [normalized] = parseAbacatePayWebhook(rawBody, signedHeaders(rawBody), { secret, signatureKey });

    expect(normalized).toMatchObject({
      dedupeKey: `abacatepay:event:log-${event}`,
      eventType: expectedType,
      providerOrderId: 'bill_one',
      callbackToken: 'opaque-callback',
      productId: 'annual-product',
    });
  });

  it('uses the payment ID as the idempotency key for subscription renewals', () => {
    const rawBody = Buffer.from(JSON.stringify({
      id: 'log-renewal', event: 'subscription.renewed', apiVersion: 2,
      data: {
        subscription: { id: 'subs_1', status: 'ACTIVE', frequency: 'ANNUALLY' },
        checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] },
        payment: { id: 'payment-unique-cycle', status: 'APPROVED', amount: 9900 },
      },
    }));

    const [normalized] = parseAbacatePayWebhook(rawBody, signedHeaders(rawBody), { secret, signatureKey });

    expect(normalized.sideEffectDedupeKey).toBe('abacatepay:subscription.payment:payment-unique-cycle');
  });

  it('does not mark an unpaid zero-amount subscription payment as approved', () => {
    const rawBody = Buffer.from(JSON.stringify({
      id: 'log-zero', event: 'subscription.completed', apiVersion: 2,
      data: {
        subscription: { id: 'subs_1', status: 'ACTIVE', frequency: 'ANNUALLY' },
        checkout: { id: 'bill_one', externalId: 'opaque-callback', items: [{ id: 'annual-product' }] },
        payment: { id: 'payment-zero', status: 'APPROVED', amount: 0 },
      },
    }));

    const [normalized] = parseAbacatePayWebhook(rawBody, signedHeaders(rawBody), { secret, signatureKey });
    expect(normalized.eventType).toBe('subscription.completed');
    expect(normalized.sideEffectDedupeKey).toBeUndefined();
  });

  it('rejects missing or mismatched secrets and invalid signatures separately', () => {
    const rawBody = Buffer.from(JSON.stringify({ id: 'log-1', event: 'checkout.completed', apiVersion: 2, data: {} }));
    const headers = signedHeaders(rawBody);

    expect(() => parseAbacatePayWebhook(rawBody, { ...headers, secret: undefined, querySecret: undefined }, { secret, signatureKey }))
      .toThrow(UnauthorizedAbacatePayWebhookError);
    expect(() => parseAbacatePayWebhook(rawBody, { ...headers, querySecret: 'incorrect-secret' }, { secret, signatureKey }))
      .toThrow(UnauthorizedAbacatePayWebhookError);
    expect(() => parseAbacatePayWebhook(rawBody, { ...headers, signature: 'invalid' }, { secret, signatureKey }))
      .toThrow(UnauthorizedAbacatePayWebhookError);

    const alteredRawBody = Buffer.concat([rawBody, Buffer.from(' ')]);
    expect(() => parseAbacatePayWebhook(alteredRawBody, headers, { secret, signatureKey }))
      .toThrow(UnauthorizedAbacatePayWebhookError);
  });

  it('rejects malformed JSON and unsupported envelope versions as payload errors', () => {
    const malformed = Buffer.from('{');
    expect(() => parseAbacatePayWebhook(malformed, signedHeaders(malformed), { secret, signatureKey }))
      .toThrow(InvalidAbacatePayWebhookPayloadError);

    const rawBody = Buffer.from(JSON.stringify({ id: 'log-1', event: 'checkout.completed', apiVersion: 1, data: {} }));
    expect(() => parseAbacatePayWebhook(rawBody, signedHeaders(rawBody), { secret, signatureKey }))
      .toThrow(InvalidAbacatePayWebhookPayloadError);
  });

  it('retains forward compatibility for unknown event names with a valid envelope', () => {
    const rawBody = Buffer.from(JSON.stringify({ id: 'log-new', event: 'future.event', apiVersion: 2, data: { added: true } }));
    const [normalized] = parseAbacatePayWebhook(rawBody, signedHeaders(rawBody), { secret, signatureKey });
    expect(normalized.eventType).toBe('future.event');
  });
});

function signedHeaders(rawBody: Buffer) {
  return {
    secret,
    querySecret: secret,
    signature: createHmac('sha256', signatureKey).update(rawBody).digest('base64'),
  };
}
