import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';

async function signIn(app: Awaited<ReturnType<typeof createTestApp>>['app'], sentMagicLinks: { link: string }[], email: string) {
  await app.inject({ method: 'POST', url: '/api/v1/auth/magic-link', payload: { email } });
  const token = new URL(sentMagicLinks.at(-1)!.link).searchParams.get('token');
  const verify = await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });
  return String(verify.headers['set-cookie']).split(';')[0]!;
}

describe('merchant recurring API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => { await close?.(); close = undefined; });

  it('generates charges idempotently, keeps old rates, records payments and manages pause/resume/end with owner isolation', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => { await app.close(); database.close(); };
    const ownerCookie = await signIn(app, sentMagicLinks, 'recurrence-owner@example.com');
    const otherCookie = await signIn(app, sentMagicLinks, 'recurrence-other@example.com');
    const ownerHeaders = { cookie: ownerCookie, origin: 'http://localhost:3000' };
    const customerResponse = await app.inject({ method: 'POST', url: '/api/v1/merchant/customers', headers: ownerHeaders, payload: { name: 'Maria Recorrente' } });
    const customerId = customerResponse.json().data.id as string;

    const create = await app.inject({
      method: 'POST', url: '/api/v1/merchant/recurrences', headers: ownerHeaders,
      payload: {
        customerId, description: 'Mensalidade de manutenção', amountMinor: 8_000,
        frequency: 'monthly', startDate: '2026-10-01', dueDay: 10, endDate: '2027-02-10',
      },
    });
    expect(create.statusCode, create.body).toBe(201);
    const planId = create.json().data.id as string;

    const listFirst = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    const listAgain = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    const plan = listFirst.json().data[0];
    expect(plan.charges).toHaveLength(5);
    expect(listAgain.json().data[0].charges).toHaveLength(5);
    expect(plan.charges.find((charge: { periodKey: string }) => charge.periodKey === '2026-11')).toMatchObject({ amountMinor: 8_000, derivedStatus: 'overdue' });

    const rate = await app.inject({
      method: 'PUT', url: `/api/v1/merchant/recurrences/${planId}/rate`, headers: ownerHeaders,
      payload: { effectiveDate: '2026-12-01', amountMinor: 9_000 },
    });
    expect(rate.statusCode).toBe(200);
    const afterRate = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    const charges = afterRate.json().data[0].charges as Array<{ id: string; periodKey: string; amountMinor: number }>;
    expect(charges.find((charge) => charge.periodKey === '2026-11')?.amountMinor).toBe(8_000);
    expect(charges.find((charge) => charge.periodKey === '2026-12')?.amountMinor).toBe(9_000);
    const novemberCharge = charges.find((charge) => charge.periodKey === '2026-11')!;

    const partial = await app.inject({
      method: 'POST', url: `/api/v1/merchant/recurring-charges/${novemberCharge.id}/payments`, headers: ownerHeaders,
      payload: { amountMinor: 1_500, method: 'pix' },
    });
    expect(partial.statusCode, partial.body).toBe(201);
    const context = await app.inject({
      method: 'GET', url: `/api/v1/merchant/recurring-charges/${novemberCharge.id}/message-context`, headers: { cookie: ownerCookie },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json().data).toMatchObject({
      customerName: 'Maria Recorrente', amountMinor: 6_500, dueDate: '2026-11-10', installmentNumber: null,
    });
    const foreign = await app.inject({
      method: 'POST', url: `/api/v1/merchant/recurring-charges/${novemberCharge.id}/payments`,
      headers: { cookie: otherCookie, origin: 'http://localhost:3000' }, payload: { amountMinor: 1, method: 'cash' },
    });
    expect(foreign.statusCode).toBe(404);

    const pause = await app.inject({ method: 'POST', url: `/api/v1/merchant/recurrences/${planId}/pause`, headers: ownerHeaders });
    expect(pause.json().data.status).toBe('paused');
    const paused = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    expect(paused.json().data[0].charges.find((charge: { periodKey: string }) => charge.periodKey === '2026-12').status).toBe('canceled');

    const resume = await app.inject({ method: 'POST', url: `/api/v1/merchant/recurrences/${planId}/resume`, headers: ownerHeaders });
    expect(resume.json().data.status).toBe('active');
    const resumed = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    expect(resumed.json().data[0].charges.find((charge: { periodKey: string }) => charge.periodKey === '2026-12').status).toBe('open');

    const end = await app.inject({ method: 'POST', url: `/api/v1/merchant/recurrences/${planId}/end`, headers: ownerHeaders });
    expect(end.json().data.status).toBe('ended');
    const afterEnd = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: ownerCookie } });
    expect(afterEnd.json().data[0].charges.find((charge: { periodKey: string }) => charge.periodKey === '2026-12').status).toBe('canceled');
    const overviewAfterEnd = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurring-overview', headers: { cookie: ownerCookie } });
    expect(overviewAfterEnd.json().data.activePlanCount).toBe(0);
    expect(overviewAfterEnd.json().data.upcoming).toEqual([]);
    const otherPlans = await app.inject({ method: 'GET', url: '/api/v1/merchant/recurrences', headers: { cookie: otherCookie } });
    expect(otherPlans.json().data).toHaveLength(0);
  });
});
