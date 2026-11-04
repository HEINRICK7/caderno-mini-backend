import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import type { JsonObject } from '../../src/domain/shared/json-value.js';
import {
  accessGrants,
  analyticsEvents,
  purchases,
  templates,
  users,
  webhookEvents,
} from '../../src/infrastructure/database/schema.js';

const secret = 'test-webhook-secret-with-at-least-16-chars';
const officialCatalog = JSON.parse(
  readFileSync(resolve(process.cwd(), 'catalog/templates.json'), 'utf8'),
) as Array<{
  id: string;
  version: number;
  name: string;
  description: string | null;
  definition: JsonObject;
  isActive: boolean;
}>;

describe('Cakto webhook API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('persists signed events before 2xx, grants only on approval, and revokes on completed refund', async () => {
    const { app, database, commerceServices, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    const officialTemplate = officialCatalog.find((template) => template.id === 'agradecimento-compra');
    expect(officialTemplate).toBeDefined();
    if (!officialTemplate) throw new Error('O modelo oficial agradecimento-compra precisa existir no catálogo.');
    const templateId = officialTemplate.id;
    insertTemplate(database.db, officialTemplate);

    const messageData = {
      recipientName: 'Maria',
      businessName: 'Cadernô Express',
      title: 'Obrigado pela sua compra',
      message: 'Sua compra foi registrada com sucesso. Esperamos que aproveite seu produto.',
      productName: 'Conjunto de mesa',
      purchaseAmount: 350,
      purchaseLink: 'https://loja.example/pedido/123',
    };

    const validation = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/validate`,
      payload: { data: messageData },
    });
    expect(validation.statusCode).toBe(200);

    const draftResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId, data: messageData },
    });
    const draftId = draftResponse.json().data.id as string;
    database.db.update(templates)
      .set({ isActive: false })
      .where(eq(templates.id, templateId))
      .run();
    database.db.insert(templates).values({
      id: templateId,
      version: officialTemplate.version + 1,
      name: 'Modelo atualizado',
      description: 'Outra versão do modelo.',
      definition: { fields: [{ id: 'newMessage', type: 'text' }] },
      isActive: true,
      createdAt: new Date(),
    }).run();
    const checkoutResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: {
        draftId,
        attribution: {
          source: 'newsletter',
          medium: 'email',
          campaign: 'birthday',
          referrerUrl: 'https://example.com/campaign?email=private@example.com',
        },
      },
    });
    const callback = new URL(checkoutResponse.json().data.checkoutUrl as string).searchParams.get('callback');

    const previewEvent = {
      eventId: '00000000-0000-4000-8000-000000000123',
      name: 'preview_viewed',
      draftId,
      templateId,
      source: 'newsletter',
      referrerUrl: 'https://example.com/preview?email=private@example.com',
    };
    const trackedPreview = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: previewEvent,
    });
    expect(trackedPreview.statusCode).toBe(202);
    expect(trackedPreview.json().data.accepted).toBe(true);
    const shareEvent = {
      eventId: '00000000-0000-4000-8000-000000000125',
      name: 'whatsapp_share_clicked',
      draftId,
      templateId,
    };
    const trackedShare = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: shareEvent,
    });
    expect(trackedShare.statusCode).toBe(202);
    expect(trackedShare.json().data.accepted).toBe(true);
    const duplicatePreview = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: previewEvent,
    });
    expect(duplicatePreview.json().data.accepted).toBe(false);
    const spoofedConversion = await app.inject({
      method: 'POST',
      url: '/api/v1/analytics/events',
      payload: { eventId: '00000000-0000-4000-8000-000000000124', name: 'purchase_paid' },
    });
    expect(spoofedConversion.statusCode).toBe(400);
    expect(database.db.select().from(analyticsEvents).all().find((event) => event.name === 'preview_viewed'))
      .toMatchObject({ source: 'newsletter', referrerHost: 'example.com' });

    const pix = await deliver(app, 'pix_gerado', order(callback, 'waiting_payment'));
    expect(pix.statusCode).toBe(202);
    expect(pix.json().data).toEqual({ accepted: 1, duplicates: 0 });
    commerceServices.processCaktoInboxBatch();

    let purchase = database.db.select().from(purchases).get();
    expect(purchase?.status).toBe('pending');
    expect(database.db.select().from(accessGrants).all()).toHaveLength(0);

    const approvalData = order(callback, 'paid');
    const approved = await deliver(app, 'purchase_approved', approvalData);
    expect(approved.statusCode).toBe(202);
    commerceServices.processCaktoInboxBatch();

    purchase = database.db.select().from(purchases).get();
    expect(purchase).toMatchObject({
      status: 'paid',
      providerOrderId: 'provider-order-1',
      customerEmail: 'buyer@example.com',
      amountMinor: 499,
      currency: 'BRL',
    });
    expect(database.db.select().from(accessGrants).get()).toMatchObject({
      purchaseId: purchase?.id,
      customerEmail: 'buyer@example.com',
      status: 'active',
    });

    const analyticsFrom = new Date(Date.now() - 60_000).toISOString();
    const analyticsTo = new Date(Date.now() + 60_000).toISOString();
    const summaryUrl = `/api/v1/analytics/summary?from=${encodeURIComponent(analyticsFrom)}&to=${encodeURIComponent(analyticsTo)}`;
    const unauthorizedSummary = await app.inject({ method: 'GET', url: summaryUrl });
    expect(unauthorizedSummary.statusCode).toBe(401);
    const summary = await app.inject({
      method: 'GET',
      url: summaryUrl,
      headers: { authorization: 'Bearer test-analytics-read-token-with-at-least-32-chars' },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().data.eventCounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'draft_created', count: 1 }),
      expect.objectContaining({ name: 'checkout_started', count: 1 }),
      expect.objectContaining({ name: 'purchase_paid', count: 1 }),
      expect.objectContaining({ name: 'preview_viewed', count: 1 }),
      expect.objectContaining({ name: 'whatsapp_share_clicked', count: 1 }),
    ]));
    expect(summary.json().data.purchaseSources).toContainEqual({
      source: 'newsletter',
      medium: 'email',
      campaign: 'birthday',
      purchases: 1,
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'buyer@example.com' },
    });
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
    const cookie = String(verify.headers['set-cookie']).split(';')[0];
    const access = await app.inject({ method: 'GET', url: '/api/v1/account/access', headers: { cookie } });
    expect(access.statusCode).toBe(200);
    expect(access.json().data[0]).toMatchObject({
      purchaseId: purchase?.id,
      draftId,
      purchaseStatus: 'paid',
      accessStatus: 'active',
    });
    const purchaseStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/purchases/${purchase?.id}`,
      headers: { cookie },
    });
    expect(purchaseStatus.json().data).toMatchObject({
      status: 'paid',
      accessStatus: 'active',
      amountMinor: 499,
      currency: 'BRL',
    });
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/drafts/${draftId}/publication`,
      headers: { cookie },
    });
    expect(published.statusCode).toBe(200);
    const publicPath = published.json().data.publicPath as string;
    const publicUrl = published.json().data.publicUrl as string;
    expect(publicUrl).toBe(`https://app.example.test${publicPath}`);
    const slug = published.json().data.slug as string;
    const publicPage = await app.inject({ method: 'GET', url: publicPath });
    expect(publicPage.statusCode).toBe(200);
    expect(publicPage.headers['content-type']).toContain('text/html');
    expect(publicPage.body).toContain(`<meta property="og:title" content="${officialTemplate.name} · Cadernô">`);
    expect(publicPage.body).toContain(`<meta property="og:url" content="${publicUrl}">`);
    expect(publicPage.body).toContain(
      `<meta property="og:image" content="https://api.example.test/api/v1/publications/${slug}.png">`,
    );
    expect(publicPage.body).toContain('<meta name="twitter:card" content="summary_large_image">');
    const hostileHostPage = await app.inject({
      method: 'GET',
      url: publicPath,
      headers: { host: 'attacker.example' },
    });
    expect(hostileHostPage.body).toContain(`<meta property="og:url" content="${publicUrl}">`);
    const publicMessage = await app.inject({
      method: 'GET',
      url: `/api/v1/publications/${slug}`,
    });
    expect(publicMessage.statusCode).toBe(200);
    expect(publicMessage.json().data).toMatchObject({
      templateId,
      templateVersion: officialTemplate.version,
      templateName: officialTemplate.name,
      publicUrl,
      templateDefinition: officialTemplate.definition,
      data: messageData,
    });
    const publicPng = await app.inject({
      method: 'GET',
      url: `/api/v1/publications/${slug}.png`,
    });
    expect(publicPng.statusCode).toBe(200);
    expect(publicPng.headers['content-type']).toContain('image/png');
    const updatedPublication = await app.inject({
      method: 'PUT',
      url: `/api/v1/drafts/${draftId}/publication`,
      headers: { cookie },
    });
    expect(updatedPublication.json().data.slug).toBe(published.json().data.slug);

    const png = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${draftId}/export.png`,
      headers: { cookie },
    });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toContain('image/png');
    expect(png.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const replay = await deliver(app, 'purchase_approved', approvalData);
    expect(replay.statusCode).toBe(202);
    expect(replay.json().data).toEqual({ accepted: 0, duplicates: 1 });
    commerceServices.processCaktoInboxBatch();
    expect(database.db.select().from(accessGrants).all()).toHaveLength(1);

    await deliver(app, 'refund_requested', order(callback, 'refund_requested'));
    commerceServices.processCaktoInboxBatch();
    expect(database.db.select().from(purchases).get()?.status).toBe('paid');
    expect(database.db.select().from(accessGrants).get()?.status).toBe('active');

    await deliver(app, 'refund', order(callback, 'refunded'));
    commerceServices.processCaktoInboxBatch();
    expect(database.db.select().from(purchases).get()?.status).toBe('refunded');
    expect(database.db.select().from(accessGrants).get()).toMatchObject({ status: 'revoked' });
    const refundedStatus = await app.inject({
      method: 'GET',
      url: `/api/v1/purchases/${purchase?.id}`,
      headers: { cookie },
    });
    expect(refundedStatus.json().data).toMatchObject({ status: 'refunded', accessStatus: 'revoked' });
    expect((await app.inject({ method: 'GET', url: publicPath })).statusCode).toBe(404);
    const deniedExport = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${draftId}/export.png`,
      headers: { cookie },
    });
    expect(deniedExport.statusCode).toBe(403);
    expect((await app.inject({
      method: 'DELETE',
      url: `/api/v1/drafts/${draftId}/publication`,
      headers: { cookie },
    })).statusCode).toBe(204);

    const processedEvents = database.db.select().from(webhookEvents).all();
    expect(processedEvents.every((event) => event.processingStatus === 'processed')).toBe(true);
    expect(processedEvents.every((event) => event.callbackHash === null && event.customerEmail === null)).toBe(true);
  });

  it('rejects an invalid signature without persisting an event', async () => {
    const { app, database } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify({ secret, event: 'purchase_approved', data: order('callback', 'paid') });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/cakto',
      headers: {
        'content-type': 'application/json',
        'x-cakto-timestamp': timestamp,
        'x-cakto-signature': 'v1=invalid',
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
    expect(database.db.select().from(webhookEvents).all()).toHaveLength(0);
  });

  it('claims a paid draft after the buyer verifies the purchase email', async () => {
    const { app, database, commerceServices, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    insertTemplate(database.db);

    const draftResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: { message: 'Olá' } },
    });
    const draftId = draftResponse.json().data.id as string;
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { draftId },
    });
    const callback = new URL(checkout.json().data.checkoutUrl as string).searchParams.get('callback');

    await deliver(app, 'purchase_approved', order(callback, 'paid'));
    commerceServices.processCaktoInboxBatch();

    const anonymousReadBeforeClaim = await app.inject({ method: 'GET', url: `/api/v1/drafts/${draftId}` });
    expect(anonymousReadBeforeClaim.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'buyer@example.com' },
    });
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
    expect(verify.statusCode).toBe(200);
    expect(database.db.select().from(users).get()?.email).toBe('buyer@example.com');
    const cookie = String(verify.headers['set-cookie']).split(';')[0];

    const claimedGrant = database.db.select().from(accessGrants).get();
    expect(claimedGrant?.userId).toBe(verify.json().data.user.id);
    const anonymousReadAfterClaim = await app.inject({ method: 'GET', url: `/api/v1/drafts/${draftId}` });
    expect(anonymousReadAfterClaim.statusCode).toBe(404);

    const ownerRead = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${draftId}`,
      headers: { cookie },
    });
    expect(ownerRead.statusCode).toBe(200);

    const anonymousUpdate = await app.inject({
      method: 'PUT',
      url: `/api/v1/drafts/${draftId}`,
      payload: { data: { message: 'alterado sem sessão' } },
    });
    expect(anonymousUpdate.statusCode).toBe(404);
  });

  it('links a newly granted draft to a buyer who already has a verified account', async () => {
    const { app, database, commerceServices, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };
    insertTemplate(database.db);

    await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email: 'buyer@example.com' } });
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
    const cookie = String(verify.headers['set-cookie']).split(';')[0];

    const draftResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: { message: 'Olá' } },
    });
    expect(draftResponse.statusCode).toBe(201);
    const draftId = draftResponse.json().data.id as string;
    const checkout = await app.inject({ method: 'POST', url: '/api/v1/checkout', payload: { draftId } });
    expect(checkout.statusCode).toBe(201);
    const callback = new URL(checkout.json().data.checkoutUrl as string).searchParams.get('callback');
    expect(callback).toBeTruthy();
    const webhook = await deliver(app, 'purchase_approved', order(callback, 'paid'));
    expect(webhook.statusCode).toBe(202);
    expect(webhook.json().data).toEqual({ accepted: 1, duplicates: 0 });
    const webhookEvent = database.db.select().from(webhookEvents).get();
    expect(webhookEvent).toMatchObject({
      providerOrderId: 'provider-order-1',
      providerStatus: 'paid',
      productId: 'test-product-id',
      offerType: 'main',
    });
    expect(webhookEvent?.callbackHash).toBe(database.db.select().from(purchases).get()?.callbackHash);
    commerceServices.processCaktoInboxBatch();

    expect(database.db.select().from(purchases).get()?.status).toBe('paid');
    const grant = database.db.select().from(accessGrants).get();
    expect(grant?.userId).toBe(verify.json().data.user.id);
    const anonymousRead = await app.inject({ method: 'GET', url: `/api/v1/drafts/${draftId}` });
    expect(anonymousRead.statusCode).toBe(404);
    const ownerRead = await app.inject({
      method: 'GET',
      url: `/api/v1/drafts/${draftId}`,
      headers: { cookie },
    });
    expect(ownerRead.statusCode).toBe(200);
    const anonymousCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { draftId },
    });
    expect(anonymousCheckout.statusCode).toBe(404);
    const ownerCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      headers: { cookie },
      payload: { draftId },
    });
    expect(ownerCheckout.statusCode).toBe(201);
  });
});

function order(callback: string | null, status: string) {
  const now = new Date().toISOString();
  return {
    id: 'provider-order-1',
    status,
    callback,
    offer_type: 'main',
    amount: 4.99,
    currency: 'BRL',
    customer: { email: 'buyer@example.com', docNumber: '12345678900' },
    product: { id: 'test-product-id' },
    offer: { id: 'test-offer' },
    createdAt: now,
    paidAt: status === 'paid' ? now : null,
  };
}

async function deliver(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  event: string,
  data: ReturnType<typeof order>,
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
