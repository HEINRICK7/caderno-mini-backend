import { and, asc, desc, eq, lte } from 'drizzle-orm';

import type { MerchantLedgerRepository, MerchantCommitmentRecord, MerchantLedgerSale } from '../../../application/ports/merchant-ledger-repository.js';
import type { MerchantPayment, MerchantSale, SaleInstallment } from '../../../domain/merchant/merchant-ledger.js';
import type { AppDatabase } from '../connection.js';
import { merchantCustomers, merchantInstallments, merchantPayments, merchantSaleItems, merchantSales } from '../schema.js';

export class SqliteMerchantLedgerRepository implements MerchantLedgerRepository {
  constructor(private readonly db: AppDatabase) {}

  insertSale(sale: MerchantSale): void {
    this.db.transaction((tx) => {
      tx.insert(merchantSales).values({
        id: sale.id,
        ownerUserId: sale.ownerUserId,
        customerId: sale.customerId,
        condition: sale.condition,
        totalMinor: sale.totalMinor,
        downPaymentMinor: sale.downPaymentMinor,
        financedMinor: sale.financedMinor,
        createdAt: sale.createdAt,
      }).run();
      if (sale.items.length) tx.insert(merchantSaleItems).values(sale.items.map((item) => ({
        ...item,
        ownerUserId: sale.ownerUserId,
        customerId: sale.customerId,
        saleId: sale.id,
      }))).run();
      if (sale.installments.length) tx.insert(merchantInstallments).values(sale.installments).run();
      if (sale.initialPayment) tx.insert(merchantPayments).values(sale.initialPayment).run();
    });
  }

  getLedger(ownerUserId: string, customerId: string): MerchantLedgerSale[] {
    const sales = this.db.select().from(merchantSales).where(and(
      eq(merchantSales.ownerUserId, ownerUserId),
      eq(merchantSales.customerId, customerId),
    )).orderBy(desc(merchantSales.createdAt)).all();
    return sales.map((sale) => ({
      ...sale,
      items: this.db.select().from(merchantSaleItems).where(and(
        eq(merchantSaleItems.ownerUserId, ownerUserId), eq(merchantSaleItems.saleId, sale.id),
      )).all(),
      installments: this.db.select().from(merchantInstallments).where(and(
        eq(merchantInstallments.ownerUserId, ownerUserId), eq(merchantInstallments.saleId, sale.id),
      )).orderBy(asc(merchantInstallments.number)).all(),
      payments: this.db.select().from(merchantPayments).where(and(
        eq(merchantPayments.ownerUserId, ownerUserId), eq(merchantPayments.saleId, sale.id),
      )).orderBy(asc(merchantPayments.paidAt)).all(),
    }));
  }

  findSale(ownerUserId: string, saleId: string): MerchantLedgerSale | undefined {
    const sale = this.db.select().from(merchantSales).where(and(
      eq(merchantSales.ownerUserId, ownerUserId), eq(merchantSales.id, saleId),
    )).get();
    return sale ? this.getLedger(ownerUserId, sale.customerId).find((entry) => entry.id === sale.id) : undefined;
  }

  findPayment(ownerUserId: string, paymentId: string): MerchantPayment | undefined {
    return this.db.select().from(merchantPayments).where(and(
      eq(merchantPayments.ownerUserId, ownerUserId), eq(merchantPayments.id, paymentId),
    )).get();
  }

  findInstallment(ownerUserId: string, installmentId: string): SaleInstallment | undefined {
    return this.db.select().from(merchantInstallments).where(and(
      eq(merchantInstallments.ownerUserId, ownerUserId), eq(merchantInstallments.id, installmentId),
    )).get();
  }

  listInstallmentPayments(ownerUserId: string, installmentId: string): MerchantPayment[] {
    return this.db.select().from(merchantPayments).where(and(
      eq(merchantPayments.ownerUserId, ownerUserId), eq(merchantPayments.installmentId, installmentId),
    )).all();
  }

  insertPayment(payment: MerchantPayment): void {
    this.db.insert(merchantPayments).values(payment).run();
  }

  listCommitments(input: { ownerUserId: string; throughDate: string }): MerchantCommitmentRecord[] {
    const rows = this.db.select({
      installment: merchantInstallments,
      customer: { id: merchantCustomers.id, name: merchantCustomers.name, whatsapp: merchantCustomers.whatsapp },
    }).from(merchantInstallments)
      .innerJoin(merchantCustomers, and(
        eq(merchantCustomers.id, merchantInstallments.customerId),
        eq(merchantCustomers.ownerUserId, input.ownerUserId),
      ))
      .where(and(
        eq(merchantInstallments.ownerUserId, input.ownerUserId),
        eq(merchantInstallments.status, 'open'),
        lte(merchantInstallments.dueDate, input.throughDate),
      ))
      .orderBy(asc(merchantInstallments.dueDate)).all();
    return rows.map(({ installment, customer }) => ({
      installment,
      customer,
      saleItems: this.db.select().from(merchantSaleItems).where(and(
        eq(merchantSaleItems.ownerUserId, input.ownerUserId), eq(merchantSaleItems.saleId, installment.saleId),
      )).all(),
      payments: this.listInstallmentPayments(input.ownerUserId, installment.id),
    }));
  }

  listRecentPayments(ownerUserId: string, limit: number): MerchantPayment[] {
    return this.db.select().from(merchantPayments).where(eq(merchantPayments.ownerUserId, ownerUserId))
      .orderBy(desc(merchantPayments.paidAt)).limit(limit).all();
  }

  countSales(ownerUserId: string): number {
    return this.db.select({ id: merchantSales.id }).from(merchantSales).where(eq(merchantSales.ownerUserId, ownerUserId)).all().length;
  }
}
