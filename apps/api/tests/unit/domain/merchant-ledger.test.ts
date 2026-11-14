import { describe, expect, it } from 'vitest';

import { createSale, getInstallmentStatus, getSaleBalance, planSaleInstallments, registerInstallmentPayment } from '../../../src/domain/merchant/merchant-ledger.js';

const now = new Date('2026-11-13T12:00:00.000Z');

describe('merchant ledger', () => {
  it('splits financed balances into exact integer cents and clamps month ends from the original due day', () => {
    const installments = planSaleInstallments({ amountMinor: 10_001, count: 3, firstDueDate: '2027-01-31' });
    expect(installments).toEqual([
      { number: 1, amountMinor: 3_334, dueDate: '2027-01-31' },
      { number: 2, amountMinor: 3_334, dueDate: '2027-02-28' },
      { number: 3, amountMinor: 3_333, dueDate: '2027-03-31' },
    ]);
    expect(installments.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(10_001);
  });

  it('rejects invalid dates, balances, and installment counts', () => {
    expect(() => planSaleInstallments({ amountMinor: 1, count: 2, firstDueDate: '2026-02-30' })).toThrow();
    expect(() => planSaleInstallments({ amountMinor: 0, count: 2, firstDueDate: '2026-12-01' })).toThrow();
    expect(() => planSaleInstallments({ amountMinor: 100, count: 1, firstDueDate: '2026-12-01' })).toThrow();
  });

  it('keeps price snapshots, records a down payment, and derives installment status from payments', () => {
    const sale = createSale({
      id: 'sale-1', ownerUserId: 'merchant-1', customerId: 'customer-1',
      items: [{ name: 'Caderno', kind: 'product', quantity: 1, unitPriceMinor: 10_001 }],
      downPaymentMinor: 1, condition: 'installments', installmentCount: 2, firstDueDate: '2026-12-13', now,
    });
    expect(sale.totalMinor).toBe(10_001);
    expect(sale.financedMinor).toBe(10_000);
    expect(sale.items[0]).toMatchObject({ name: 'Caderno', lineTotalMinor: 10_001 });
    expect(getSaleBalance(sale, sale.initialPayment ? [sale.initialPayment] : [])).toBe(10_000);

    const first = sale.installments[0]!;
    expect(getInstallmentStatus(first, [], '2026-12-13')).toBe('due_today');
    const payment = registerInstallmentPayment({ id: 'payment-1', installment: first, amountMinor: 1250, method: 'pix', now });
    expect(getInstallmentStatus(first, [payment], '2026-12-13')).toBe('partially_paid');
    expect(() => registerInstallmentPayment({ id: 'payment-2', installment: first, amountMinor: 99_000, method: 'cash', now })).toThrow();
  });

  it('rejects a sale with invalid lines or a down payment above its total', () => {
    expect(() => createSale({
      id: 'sale-2', ownerUserId: 'merchant-1', customerId: 'customer-1',
      items: [{ name: 'X', kind: 'product', quantity: 0, unitPriceMinor: 100 }],
      downPaymentMinor: 0, condition: 'single_due', firstDueDate: '2026-12-01', now,
    })).toThrow();
    expect(() => createSale({
      id: 'sale-3', ownerUserId: 'merchant-1', customerId: 'customer-1',
      items: [{ name: 'X', kind: 'product', quantity: 1, unitPriceMinor: 100 }],
      downPaymentMinor: 101, condition: 'cash', now,
    })).toThrow();
  });
});
