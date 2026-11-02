import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { accessGrants } from '../../src/infrastructure/database/schema.js';
import type { JsonObject } from '../../src/domain/shared/json-value.js';
import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';

const secret = 'test-webhook-secret-with-at-least-16-chars';
const plans = {
  annual: {
    checkoutUrl: 'https://pay.cakto.com.br/annual-offer',
    productId: 'annual-product',
    webhookSecret: secret,
  },
  lifetime: {
    checkoutUrl: 'https://pay.cakto.com.br/lifetime-offer',
    productId: 'lifetime-product',
    webhookSecret: secret,
  },
};
const officialCatalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'catalog/templates.json'), 'utf8'),
) as Array<{ id: string; version: number; name: string; description: string | null; definition: JsonObject; isActive: boolean }>;

describe('plan access terms', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('ends annual access twelve months after payment and keeps lifetime access open', async () => {
    const { app, database, commerceServices } = await createTestApp(':memory:', { plans });
    close = async () => {
      await app.close();
      database.close();
    };
    const template = officialCatalog.find((item) => item.id === 'agradecimento-compra');
    if (!template) throw new Error('O modelo oficial agradecimento-compra precisa existir no catálogo.');
    insertTemplate(database.db, template);
    const annualDraft = await createDraft(app, template.id);
    const lifetimeDraft = await createDraft(app, template.id);

    const annualGrant = await pay(app, commerceServices, database, annualDraft, 'annual', 'annual-order');
    const lifetimeGrant = await pay(app, commerceServices, database, lifetimeDraft, 'lifetime', 'lifetime-order');
    const yearLater = new Date(annualGrant.grantedAt.getTime());
    yearLater.setUTCMonth(yearLater.getUTCMonth() + 12);

    expect(annualGrant.expiresAt?.toISOString()).toBe(yearLater.toISOString());
    expect(lifetimeGrant.expiresAt).toBeNull();
    const purchases = new (await import('../../src/infrastructure/database/repositories/sqlite-purchase-repository.js')).SqlitePurchaseRepository(database.db);
    expect(purchases.hasActiveGrantForDraft(annualDraft, annualGrant.grantedAt)).toBe(true);
    expect(purchases.hasActiveGrantForDraft(annualDraft, yearLater)).toBe(false);
    expect(purchases.hasActiveGrantForDraft(lifetimeDraft, yearLater)).toBe(true);
  });
});

async function createDraft(app: Awaited<ReturnType<typeof createTestApp>>['app'], templateId: string) {
  const data = {
    recipientName: 'Maria',
    businessName: 'Cadernô Express',
    title: 'Obrigado pela sua compra',
    message: 'Sua compra foi registrada com sucesso. Esperamos que aproveite seu produto.',
    productName: 'Conjunto de mesa',
    purchaseAmount: 350,
    purchaseLink: 'https://loja.example/pedido/123',
  };
  const draft = await app.inject({ method: 'POST', url: '/api/v1/drafts', payload: { templateId, data } });
  expect(draft.statusCode).toBe(201);
  return draft.json().data.id as string;
}

async function pay(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  commerceServices: Awaited<ReturnType<typeof createTestApp>>['commerceServices'],
  database: Awaited<ReturnType<typeof createTestApp>>['database'],
  draftId: string,
  plan: 'annual' | 'lifetime',
  orderId: string,
) {
  const checkout = await app.inject({
    method: 'POST',
    url: '/api/v1/checkout',
    payload: { draftId, plan },
  });
  expect(checkout.statusCode).toBe(201);
  const callback = new URL(checkout.json().data.checkoutUrl as string).searchParams.get('callback');
  const approved = await deliver(app, 'purchase_approved', {
    id: orderId,
    status: 'paid',
    callback,
    offer_type: 'main',
    amount: plan === 'annual' ? 33.5 : 67,
    currency: 'BRL',
    customer: { email: 'buyer@example.com' },
    product: { id: plans[plan].productId },
    offer: { id: plan },
  });
  expect(approved.statusCode).toBe(202);
  commerceServices.processCaktoInboxBatch();
  const grant = database.db.select().from(accessGrants).all().find((item) => item.purchaseId === checkout.json().data.purchaseId);
  if (!grant) throw new Error('A licença não foi gravada.');
  return grant;
}

async function deliver(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  event: string,
  data: Record<string, unknown>,
) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({ secret, event, data });
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/cakto',
    headers: {
      'content-type': 'application/json',
      'x-cakto-timestamp': timestamp,
      'x-cakto-signature': `v1=${signature}`,
    },
    payload: rawBody,
  });
}
