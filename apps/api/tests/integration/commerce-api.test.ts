import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';
import { purchases } from '../../src/infrastructure/database/schema.js';

describe('checkout API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('creates a pending purchase locally and adds its opaque callback to the configured Cakto offer', async () => {
    const { app, database } = await createTestApp();
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

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { draftId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = response.json().data;
    const checkoutUrl = new URL(data.checkoutUrl as string);
    const callback = checkoutUrl.searchParams.get('callback');
    expect(checkoutUrl.origin).toBe('https://pay.cakto.com.br');
    expect(callback).toMatch(/^[A-Za-z0-9_-]{36}$/);
    expect(data).toMatchObject({ status: 'pending' });

    const purchase = database.db.select().from(purchases).get();
    expect(purchase).toMatchObject({
      id: data.purchaseId,
      draftId,
      status: 'pending',
    });
    expect(purchase?.callbackHash).not.toBe(callback);
  });

  it('does not start checkout for an unknown draft', async () => {
    const { app, database } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { draftId: '00000000-0000-4000-8000-000000000001' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('DRAFT_NOT_FOUND');
    expect(database.db.select().from(purchases).all()).toHaveLength(0);
  });

  it('blocks platform-plan checkout when disabled while leaving message checkout available', async () => {
    const { app, database } = await createTestApp(':memory:', { platformCheckoutEnabled: false });
    close = async () => {
      await app.close();
      database.close();
    };
    insertTemplate(database.db);

    const availability = await app.inject({ method: 'GET', url: '/api/v1/checkout/availability' });
    expect(availability.statusCode).toBe(200);
    expect(availability.json().data.enabled).toBe(false);

    const platformCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { plan: 'annual' },
    });
    expect(platformCheckout.statusCode).toBe(503);
    expect(platformCheckout.json().error.code).toBe('PLATFORM_CHECKOUT_PAUSED');
    expect(database.db.select().from(purchases).all()).toHaveLength(0);

    const draftResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/drafts',
      payload: { templateId: 'mensagem-exemplo', data: { message: 'Olá' } },
    });
    const messageCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      payload: { draftId: draftResponse.json().data.id },
    });

    expect(messageCheckout.statusCode).toBe(201);
  });
});
