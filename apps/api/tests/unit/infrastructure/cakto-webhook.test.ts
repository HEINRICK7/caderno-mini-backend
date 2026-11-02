import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InvalidCaktoWebhookError } from '../../../src/application/errors.js';
import { parseCaktoWebhook } from '../../../src/infrastructure/payments/cakto/webhook.js';

const secret = 'cakto-test-webhook-secret';
const now = new Date('2026-10-31T21:30:00.000Z');
const order = {
  id: 'order-123',
  status: 'paid',
  callback: 'aAbBcCdD_123-~',
  amount: 49.9,
  currency: 'BRL',
  offer_type: 'main',
  customer: { email: 'Buyer@Example.com', docNumber: '12345678900', phone: '5511999999999' },
  product: { id: 'product-1' },
  offer: { id: 'offer-1' },
  createdAt: '2026-10-31T21:29:00.000Z',
  paidAt: '2026-10-31T21:29:30.000Z',
};

function signedRequest(payload: unknown, timestamp = String(Math.floor(now.getTime() / 1000))) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
  return { rawBody, headers: { timestamp, signature: `v1=${signature}` } };
}

describe('parseCaktoWebhook', () => {
  it('verifies the signature over raw bytes and normalizes only fields the backend needs', () => {
    const request = signedRequest({ secret, event: 'purchase_approved', data: order });

    expect(parseCaktoWebhook(request.rawBody, request.headers, { secret, now })).toEqual([
      expect.objectContaining({
        eventType: 'purchase_approved',
        providerOrderId: 'order-123',
        providerStatus: 'paid',
        callbackToken: 'aAbBcCdD_123-~',
        customerEmail: 'buyer@example.com',
        productId: 'product-1',
        offerId: 'offer-1',
        offerType: 'main',
        amountMinor: 4990,
        currency: 'BRL',
        occurredAt: '2026-10-31T21:29:30.000Z',
      }),
    ]);
    expect(JSON.stringify(parseCaktoWebhook(request.rawBody, request.headers, { secret, now })))
      .not.toContain('12345678900');
  });

  it('normalizes each order in a V2 data array independently', () => {
    const request = signedRequest({
      secret,
      event: 'purchase_approved',
      data: [order, { ...order, id: 'order-456', offer_type: 'orderbump' }],
    });

    expect(parseCaktoWebhook(request.rawBody, request.headers, { secret, now }).map((item) => item.providerOrderId))
      .toEqual(['order-123', 'order-456']);
  });

  it('deduplicates checkout abandonment without inventing an order ID or retaining email', () => {
    const request = signedRequest({
      secret,
      event: 'checkout_abandonment',
      data: {
        offer: { id: 'offer-1' },
        customerEmail: 'Buyer@Example.com',
        createdAt: '2026-10-31T21:29:00.000Z',
      },
    });

    const [event] = parseCaktoWebhook(request.rawBody, request.headers, { secret, now });
    expect(event).toMatchObject({ eventType: 'checkout_abandonment', offerId: 'offer-1' });
    expect(event).not.toHaveProperty('providerOrderId');
    expect(event).not.toHaveProperty('customerEmail');
  });

  it.each([
    ['invalid signature', 'bad'],
    ['expired timestamp', String(Math.floor(now.getTime() / 1000) - 301)],
  ])('rejects an %s', (description, value) => {
    const request = signedRequest({ secret, event: 'purchase_approved', data: order });
    const headers = description === 'invalid signature'
      ? { ...request.headers, signature: value }
      : { ...request.headers, timestamp: value };

    expect(() => parseCaktoWebhook(request.rawBody, headers, { secret, now })).toThrow(
      InvalidCaktoWebhookError,
    );
  });

  it('rejects a modified body and a mismatched body secret', () => {
    const signed = signedRequest({ secret, event: 'purchase_approved', data: order });
    const modifiedBody = Buffer.from(signed.rawBody.toString().replace('paid', 'waiting_payment'));
    expect(() => parseCaktoWebhook(modifiedBody, signed.headers, { secret, now })).toThrow(
      InvalidCaktoWebhookError,
    );

    const mismatched = signedRequest({ secret: 'another-secret', event: 'purchase_approved', data: order });
    expect(() => parseCaktoWebhook(mismatched.rawBody, mismatched.headers, { secret, now })).toThrow(
      InvalidCaktoWebhookError,
    );
  });
});
