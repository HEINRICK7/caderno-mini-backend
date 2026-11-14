import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';

async function signIn(app: Awaited<ReturnType<typeof createTestApp>>['app'], sentMagicLinks: { link: string }[], email: string) {
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/magic-link',
    payload: { email },
  });
  expect(request.statusCode).toBe(202);

  const token = new URL(sentMagicLinks.at(-1)!.link).searchParams.get('token');
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
  expect(verify.statusCode).toBe(200);
  return String(verify.headers['set-cookie']).split(';')[0]!;
}

describe('merchant directory API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('requires a merchant session and isolates customer records by the authenticated owner', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/merchant/customers' });
    expect(anonymous.statusCode).toBe(401);

    const ownerCookie = await signIn(app, sentMagicLinks, 'owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'other@example.com');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/customers',
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { name: '  Maria Silva  ', whatsapp: '(85) 99999-1234', email: 'maria@example.com' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data).toMatchObject({
      name: 'Maria Silva',
      whatsapp: '(85) 99999-1234',
      email: 'maria@example.com',
      status: 'active',
    });
    expect(create.json().data.ownerUserId).toBeUndefined();
    const customerId = create.json().data.id as string;

    const ownerList = await app.inject({ method: 'GET', url: '/api/v1/merchant/customers?q=maria', headers: { cookie: ownerCookie } });
    const otherList = await app.inject({ method: 'GET', url: '/api/v1/merchant/customers', headers: { cookie: otherCookie } });
    const otherDetail = await app.inject({ method: 'GET', url: `/api/v1/merchant/customers/${customerId}`, headers: { cookie: otherCookie } });
    expect(ownerList.json().data).toHaveLength(1);
    expect(otherList.json().data).toHaveLength(0);
    expect(otherDetail.statusCode).toBe(404);

    const spoofedOwner = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/customers',
      headers: { cookie: ownerCookie },
      payload: { name: 'Cliente falso', ownerUserId: 'other-user' },
    });
    expect(spoofedOwner.statusCode).toBe(400);

    const crossOriginMutation = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/customers',
      headers: { cookie: ownerCookie, origin: 'https://attacker.example' },
      payload: { name: 'Cliente bloqueado' },
    });
    expect(crossOriginMutation.statusCode).toBe(403);

    const archive = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchant/customers/${customerId}`,
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { name: 'Maria Silva', whatsapp: '(85) 99999-1234', email: 'maria@example.com', status: 'archived' },
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json().data.status).toBe('archived');
    const activeOnly = await app.inject({ method: 'GET', url: '/api/v1/merchant/customers', headers: { cookie: ownerCookie } });
    const allStatuses = await app.inject({ method: 'GET', url: '/api/v1/merchant/customers?status=all', headers: { cookie: ownerCookie } });
    expect(activeOnly.json().data).toHaveLength(0);
    expect(allStatuses.json().data).toHaveLength(1);
  });

  it('creates, searches, updates and isolates catalog items with integer-cent prices', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };
    const ownerCookie = await signIn(app, sentMagicLinks, 'catalog-owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'catalog-other@example.com');

    const invalidPrice = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/catalog-items',
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'product', name: 'Caderno', priceMinor: -25 },
    });
    expect(invalidPrice.statusCode).toBe(400);

    const missingPrice = await app.inject({
      method: 'POST', url: '/api/v1/merchant/catalog-items',
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'product', name: 'Preço ausente' },
    });
    expect(missingPrice.statusCode).toBe(400);

    const freeItem = await app.inject({
      method: 'POST', url: '/api/v1/merchant/catalog-items',
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'service', name: 'Orientação gratuita', priceMinor: 0 },
    });
    expect(freeItem.statusCode).toBe(201);
    expect(freeItem.json().data.priceMinor).toBe(0);

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/merchant/catalog-items',
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'service', name: '  Manutenção  ', description: 'Limpeza mensal', priceMinor: 12550 },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().data).toMatchObject({
      kind: 'service',
      name: 'Manutenção',
      description: 'Limpeza mensal',
      priceMinor: 12550,
      status: 'active',
    });
    expect(create.json().data.ownerUserId).toBeUndefined();
    const itemId = create.json().data.id as string;

    const ownerSearch = await app.inject({ method: 'GET', url: '/api/v1/merchant/catalog-items?q=manu&kind=service', headers: { cookie: ownerCookie } });
    const otherSearch = await app.inject({ method: 'GET', url: '/api/v1/merchant/catalog-items', headers: { cookie: otherCookie } });
    expect(ownerSearch.json().data).toHaveLength(1);
    expect(otherSearch.json().data).toHaveLength(0);

    const update = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchant/catalog-items/${itemId}`,
      headers: { cookie: ownerCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'service', name: 'Manutenção', description: 'Pacote trimestral', priceMinor: 15000, status: 'active' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().data).toMatchObject({ description: 'Pacote trimestral', priceMinor: 15000 });

    const otherEdit = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchant/catalog-items/${itemId}`,
      headers: { cookie: otherCookie, origin: 'http://localhost:3000' },
      payload: { kind: 'service', name: 'Alteração indevida', description: '', priceMinor: 1, status: 'active' },
    });
    expect(otherEdit.statusCode).toBe(404);
  });

  it('registers an independent installment sale, keeps item snapshots, records partial payments, and isolates the ledger', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };
    const ownerCookie = await signIn(app, sentMagicLinks, 'ledger-owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'ledger-other@example.com');
    const ownerHeaders = { cookie: ownerCookie, origin: 'http://localhost:3000' };

    const customerResponse = await app.inject({
      method: 'POST', url: '/api/v1/merchant/customers', headers: ownerHeaders, payload: { name: 'Maria Silva' },
    });
    const customerId = customerResponse.json().data.id as string;
    const catalogResponse = await app.inject({
      method: 'POST', url: '/api/v1/merchant/catalog-items', headers: ownerHeaders,
      payload: { kind: 'product', name: 'Caderno A5', priceMinor: 10_002 },
    });
    const catalogItemId = catalogResponse.json().data.id as string;

    const saleResponse = await app.inject({
      method: 'POST', url: '/api/v1/merchant/sales', headers: ownerHeaders,
      payload: {
        customerId,
        items: [{ catalogItemId, quantity: 1 }],
        condition: 'installments', downPaymentMinor: 1, installmentCount: 2,
        firstDueDate: '2027-01-31', initialPaymentMethod: 'pix',
      },
    });
    expect(saleResponse.statusCode, saleResponse.body).toBe(201);
    expect(saleResponse.json().data).toMatchObject({ totalMinor: 10_002, financedMinor: 10_001 });
    const saleId = saleResponse.json().data.id as string;
    const installments = saleResponse.json().data.installments as Array<{ id: string; amountMinor: number; dueDate: string }>;
    expect(installments.map(({ amountMinor, dueDate }) => ({ amountMinor, dueDate }))).toEqual([
      { amountMinor: 5_001, dueDate: '2027-01-31' },
      { amountMinor: 5_000, dueDate: '2027-02-28' },
    ]);

    const otherLedger = await app.inject({
      method: 'GET', url: `/api/v1/merchant/customers/${customerId}/ledger`, headers: { cookie: otherCookie },
    });
    expect(otherLedger.statusCode).toBe(404);
    const foreignPayment = await app.inject({
      method: 'POST', url: `/api/v1/merchant/installments/${installments[0]!.id}/payments`,
      headers: { cookie: otherCookie, origin: 'http://localhost:3000' }, payload: { amountMinor: 1, method: 'cash' },
    });
    expect(foreignPayment.statusCode).toBe(404);

    const payment = await app.inject({
      method: 'POST', url: `/api/v1/merchant/installments/${installments[0]!.id}/payments`,
      headers: ownerHeaders, payload: { amountMinor: 1_200, method: 'pix', reference: 'recebido no banco' },
    });
    expect(payment.statusCode).toBe(201);
    const messageContext = await app.inject({
      method: 'GET', url: `/api/v1/merchant/installments/${installments[0]!.id}/message-context`, headers: { cookie: ownerCookie },
    });
    expect(messageContext.statusCode).toBe(200);
    expect(messageContext.json().data).toMatchObject({
      customerName: 'Maria Silva', amountMinor: 3_801, dueDate: '2027-01-31', installmentNumber: 1, installmentTotal: 2,
    });
    const overpayment = await app.inject({
      method: 'POST', url: `/api/v1/merchant/installments/${installments[0]!.id}/payments`,
      headers: ownerHeaders, payload: { amountMinor: 9_000, method: 'cash' },
    });
    expect(overpayment.statusCode).toBe(400);

    const ledger = await app.inject({
      method: 'GET', url: `/api/v1/merchant/customers/${customerId}/ledger`, headers: { cookie: ownerCookie },
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().data.sales).toHaveLength(1);
    expect(ledger.json().data.sales[0]).toMatchObject({ id: saleId, items: [{ name: 'Caderno A5', unitPriceMinor: 10_002 }] });
    expect(ledger.json().data.sales[0].installments[0]).toMatchObject({ paidMinor: 1_200, balanceMinor: 3_801, derivedStatus: 'partially_paid' });
  });
});
