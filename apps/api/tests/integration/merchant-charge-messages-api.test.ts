import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';
import { insertTemplate } from '../helpers/template-fixture.js';

async function signIn(app: Awaited<ReturnType<typeof createTestApp>>['app'], sentMagicLinks: { link: string }[], email: string) {
  await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email } });
  const token = new URL(sentMagicLinks.at(-1)!.link).searchParams.get('token');
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
  return String(verify.headers['set-cookie']).split(';')[0]!;
}

describe('merchant charge messages API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => { await close?.(); close = undefined; });

  it('links owner-created billing drafts to the source and lists them in that customer ledger', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };
    insertTemplate(database.db, { id: 'merchant-charge-message', name: 'Cobrança Pix' });
    const ownerCookie = await signIn(app, sentMagicLinks, 'charge-message-owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'charge-message-other@example.com');
    const ownerHeaders = { cookie: ownerCookie, origin: 'http://localhost:3000' };

    const customer = await app.inject({
      method: 'POST', url: '/api/v1/merchant/customers', headers: ownerHeaders, payload: { name: 'Ana Cliente' },
    });
    const customerId = customer.json().data.id as string;
    const sale = await app.inject({
      method: 'POST', url: '/api/v1/merchant/sales', headers: ownerHeaders,
      payload: {
        customerId, items: [{ name: 'Mensalidade', kind: 'service', quantity: 1, unitPriceMinor: 4_500 }],
        condition: 'single_due', firstDueDate: '2026-12-01',
      },
    });
    const installmentId = sale.json().data.installments[0].id as string;
    const draft = await app.inject({
      method: 'POST', url: '/api/v1/drafts', headers: ownerHeaders,
      payload: { templateId: 'merchant-charge-message', data: { recipient: 'Ana Cliente', message: 'Confira o QR Code Pix.' } },
    });
    expect(draft.statusCode).toBe(201);

    const link = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages', headers: ownerHeaders,
      payload: { sourceType: 'sale_installment', sourceId: installmentId, draftId: draft.json().data.id },
    });
    expect(link.statusCode, link.body).toBe(201);
    expect(link.json().data).toMatchObject({ customerId, sourceType: 'sale_installment', sourceId: installmentId, draftId: draft.json().data.id });

    const messages = await app.inject({ method: 'GET', url: `/api/v1/merchant/customers/${customerId}/charge-messages`, headers: { cookie: ownerCookie } });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().data).toMatchObject([{ draftId: draft.json().data.id, templateId: 'merchant-charge-message', templateName: 'Cobrança Pix' }]);

    const recurringPlan = await app.inject({
      method: 'POST', url: '/api/v1/merchant/recurrences', headers: ownerHeaders,
      payload: { customerId, description: 'Mensalidade', amountMinor: 4_500, frequency: 'monthly', startDate: '2026-11-13', dueDay: 13 },
    });
    expect(recurringPlan.statusCode, recurringPlan.body).toBe(201);
    const listedPlan = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    const recurringChargeId = listedPlan.json().data[0].charges[0].id as string;
    const recurringDraft = await app.inject({
      method: 'POST', url: '/api/v1/drafts', headers: ownerHeaders,
      payload: { templateId: 'merchant-charge-message', data: { recipient: 'Ana Cliente', message: 'Cobrança recorrente.' } },
    });
    const recurringLink = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages', headers: ownerHeaders,
      payload: { sourceType: 'recurring_charge', sourceId: recurringChargeId, draftId: recurringDraft.json().data.id },
    });
    expect(recurringLink.statusCode, recurringLink.body).toBe(201);
    const allMessages = await app.inject({ method: 'GET', url: `/api/v1/merchant/customers/${customerId}/charge-messages`, headers: { cookie: ownerCookie } });
    expect(allMessages.json().data).toHaveLength(2);

    const foreignLink = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages',
      headers: { cookie: otherCookie, origin: 'http://localhost:3000' },
      payload: { sourceType: 'sale_installment', sourceId: installmentId, draftId: draft.json().data.id },
    });
    expect(foreignLink.statusCode).toBe(404);
    const foreignList = await app.inject({ method: 'GET', url: `/api/v1/merchant/customers/${customerId}/charge-messages`, headers: { cookie: otherCookie } });
    expect(foreignList.statusCode).toBe(404);

    const conflictingLink = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages', headers: ownerHeaders,
      payload: { sourceType: 'sale_installment', sourceId: `${installmentId}-different`, draftId: draft.json().data.id },
    });
    expect(conflictingLink.statusCode).toBe(404);
  });

  it('provides owner-scoped contexts for sale thanks and manually recorded payments', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };
    insertTemplate(database.db, { id: 'merchant-charge-message', name: 'Mensagem de pagamento' });
    const ownerCookie = await signIn(app, sentMagicLinks, 'message-context-owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'message-context-other@example.com');
    const ownerHeaders = { cookie: ownerCookie, origin: 'http://localhost:3000' };
    const customer = await app.inject({ method: 'POST', url: '/api/v1/merchant/customers', headers: ownerHeaders, payload: { name: 'Ana Cliente' } });
    const customerId = customer.json().data.id as string;
    const sale = await app.inject({
      method: 'POST', url: '/api/v1/merchant/sales', headers: ownerHeaders,
      payload: { customerId, items: [{ name: 'Caderno artesanal', kind: 'product', quantity: 1, unitPriceMinor: 7_250 }], condition: 'single_due', firstDueDate: '2026-12-01' },
    });
    expect(sale.statusCode, sale.body).toBe(201);
    const saleId = sale.json().data.id as string;
    const installmentId = sale.json().data.installments[0].id as string;

    const saleContext = await app.inject({ method: 'GET', url: `/api/v1/merchant/sales/${saleId}/message-context`, headers: { cookie: ownerCookie } });
    expect(saleContext.statusCode).toBe(200);
    expect(saleContext.json().data).toMatchObject({ sourceType: 'sale', customerId, amountMinor: 7_250, dueDate: null, paidAt: null, itemNames: ['Caderno artesanal'] });
    const foreignSaleContext = await app.inject({ method: 'GET', url: `/api/v1/merchant/sales/${saleId}/message-context`, headers: { cookie: otherCookie } });
    expect(foreignSaleContext.statusCode).toBe(404);

    const salePayment = await app.inject({
      method: 'POST', url: `/api/v1/merchant/installments/${installmentId}/payments`, headers: ownerHeaders,
      payload: { amountMinor: 2_000, method: 'pix' },
    });
    expect(salePayment.statusCode, salePayment.body).toBe(201);
    const salePaymentId = salePayment.json().data.id as string;
    const salePaymentContext = await app.inject({ method: 'GET', url: `/api/v1/merchant/sales/payments/${salePaymentId}/message-context`, headers: { cookie: ownerCookie } });
    expect(salePaymentContext.statusCode).toBe(200);
    expect(salePaymentContext.json().data).toMatchObject({ sourceType: 'sale_payment', customerId, amountMinor: 2_000, paidAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), itemNames: ['Caderno artesanal'] });

    const plan = await app.inject({
      method: 'POST', url: '/api/v1/merchant/recurrences', headers: ownerHeaders,
      payload: { customerId, description: 'Aula mensal', amountMinor: 3_000, frequency: 'monthly', startDate: '2026-11-13', dueDay: 13 },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const plans = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    const recurringChargeId = plans.json().data[0].charges[0].id as string;
    const recurringPayment = await app.inject({
      method: 'POST', url: `/api/v1/merchant/recurring-charges/${recurringChargeId}/payments`, headers: ownerHeaders,
      payload: { amountMinor: 3_000, method: 'bank_transfer' },
    });
    expect(recurringPayment.statusCode, recurringPayment.body).toBe(201);
    const recurringPaymentId = recurringPayment.json().data.id as string;
    const recurringPaymentContext = await app.inject({ method: 'GET', url: `/api/v1/merchant/recurring-charges/payments/${recurringPaymentId}/message-context`, headers: { cookie: ownerCookie } });
    expect(recurringPaymentContext.statusCode).toBe(200);
    expect(recurringPaymentContext.json().data).toMatchObject({ sourceType: 'recurring_payment', customerId, amountMinor: 3_000, itemNames: ['Aula mensal'] });

    const draft = await app.inject({
      method: 'POST', url: '/api/v1/drafts', headers: ownerHeaders,
      payload: { templateId: 'merchant-charge-message', data: { recipient: 'Ana Cliente', message: 'Obrigado pela compra.' } },
    });
    const linkedSale = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages', headers: ownerHeaders,
      payload: { sourceType: 'sale', sourceId: saleId, draftId: draft.json().data.id },
    });
    expect(linkedSale.statusCode, linkedSale.body).toBe(201);
    const paymentDraft = await app.inject({
      method: 'POST', url: '/api/v1/drafts', headers: ownerHeaders,
      payload: { templateId: 'merchant-charge-message', data: { recipient: 'Ana Cliente', message: 'Pagamento registrado.' } },
    });
    const linkedPayment = await app.inject({
      method: 'POST', url: '/api/v1/merchant/charge-messages', headers: ownerHeaders,
      payload: { sourceType: 'sale_payment', sourceId: salePaymentId, draftId: paymentDraft.json().data.id },
    });
    expect(linkedPayment.statusCode, linkedPayment.body).toBe(201);
    expect(linkedPayment.json().data).toMatchObject({ customerId, sourceType: 'sale_payment', sourceId: salePaymentId });
    const foreignPaymentContext = await app.inject({ method: 'GET', url: `/api/v1/merchant/sales/payments/${salePaymentId}/message-context`, headers: { cookie: otherCookie } });
    expect(foreignPaymentContext.statusCode).toBe(404);
  });
});
