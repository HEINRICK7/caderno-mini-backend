import type { MerchantPayment, MerchantSale, SaleInstallment, SaleItem } from '../../domain/merchant/merchant-ledger.js';

export type MerchantLedgerSale = Omit<MerchantSale, 'items' | 'installments' | 'initialPayment'> & {
  items: SaleItem[];
  installments: SaleInstallment[];
  payments: MerchantPayment[];
};

export type MerchantCommitmentRecord = {
  installment: SaleInstallment;
  customer: { id: string; name: string; whatsapp: string | null };
  saleItems: SaleItem[];
  payments: MerchantPayment[];
};

export type MerchantLedgerRepository = {
  insertSale(sale: MerchantSale): void;
  getLedger(ownerUserId: string, customerId: string): MerchantLedgerSale[];
  findSale(ownerUserId: string, saleId: string): MerchantLedgerSale | undefined;
  findPayment(ownerUserId: string, paymentId: string): MerchantPayment | undefined;
  findInstallment(ownerUserId: string, installmentId: string): SaleInstallment | undefined;
  listInstallmentPayments(ownerUserId: string, installmentId: string): MerchantPayment[];
  insertPayment(payment: MerchantPayment): void;
  listCommitments(input: { ownerUserId: string; throughDate: string }): MerchantCommitmentRecord[];
  listRecentPayments(ownerUserId: string, limit: number): MerchantPayment[];
  countSales(ownerUserId: string): number;
};
