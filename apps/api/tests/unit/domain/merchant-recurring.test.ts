import { describe, expect, it } from 'vitest';

import { generateRecurringOccurrences, getRecurringChargeStatus, registerRecurringChargePayment } from '../../../src/domain/merchant/merchant-recurring.js';

const basePlan = {
  id: 'plan-1', ownerUserId: 'merchant-1', customerId: 'customer-1', description: 'Mensalidade',
  catalogItemId: null, frequency: 'monthly' as const, startDate: '2027-01-01', dueDay: 31,
  endDate: null, totalCycles: null, status: 'active' as const, amountMinor: 8000,
};

describe('merchant recurring charges', () => {
  it('generates a bounded, idempotent schedule and clamps the 29th, 30th and 31st to month ends', () => {
    const generated = generateRecurringOccurrences({ plan: basePlan, throughDate: '2027-04-30', now: new Date('2027-01-01T00:00:00Z') });
    expect(generated.map((row) => [row.periodKey, row.dueDate, row.amountMinor])).toEqual([
      ['2027-01', '2027-01-31', 8000], ['2027-02', '2027-02-28', 8000],
      ['2027-03', '2027-03-31', 8000], ['2027-04', '2027-04-30', 8000],
    ]);
    expect(generateRecurringOccurrences({ plan: basePlan, throughDate: '2027-01-01', now: new Date('2027-01-01T00:00:00Z') })).toHaveLength(0);
  });

  it('applies future rates without rewriting already paid charges and skips cycles during a pause', () => {
    const generated = generateRecurringOccurrences({
      plan: { ...basePlan, startDate: '2027-01-01', dueDay: 10 },
      throughDate: '2027-04-30', now: new Date('2027-01-01T00:00:00Z'),
      rateChanges: [{ effectiveDate: '2027-03-01', amountMinor: 9_000 }],
      pauses: [{ startDate: '2027-02-01', endDate: '2027-03-01' }],
    });
    expect(generated.map((row) => [row.periodKey, row.amountMinor])).toEqual([
      ['2027-01', 8_000], ['2027-03', 9_000], ['2027-04', 9_000],
    ]);
  });

  it('stops at the end date or cycle limit and handles weekly and fortnightly intervals', () => {
    const weekly = generateRecurringOccurrences({
      plan: { ...basePlan, frequency: 'weekly', startDate: '2027-01-01', dueDay: null, totalCycles: 3, endDate: null },
      throughDate: '2027-02-01', now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(weekly.map((row) => row.dueDate)).toEqual(['2027-01-01', '2027-01-08', '2027-01-15']);
  });

  it('derives payment state and prevents overpaying a recurring charge', () => {
    const charge = { id: 'charge-1', ownerUserId: 'merchant-1', customerId: 'customer-1', planId: 'plan-1', periodKey: '2027-01', amountMinor: 8000, dueDate: '2027-01-10', status: 'open' as const };
    const payment = registerRecurringChargePayment({ id: 'payment-1', charge, existingPaidMinor: 2_000, amountMinor: 1_000, method: 'pix', now: new Date('2027-01-11T00:00:00Z') });
    expect(payment.amountMinor).toBe(1_000);
    expect(getRecurringChargeStatus(charge, 3_000, '2027-01-11')).toBe('partially_paid');
    expect(() => registerRecurringChargePayment({ id: 'payment-2', charge, existingPaidMinor: 7_000, amountMinor: 1_001, method: 'cash', now: new Date() })).toThrow();
  });
});
