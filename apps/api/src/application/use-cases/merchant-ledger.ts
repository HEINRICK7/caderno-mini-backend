import type { MerchantDirectoryRepository } from '../ports/merchant-directory-repository.js';
import type { MerchantLedgerRepository } from '../ports/merchant-ledger-repository.js';
import {
  createSale,
  getInstallmentStatus,
  getSaleBalance,
  registerInstallmentPayment,
  MerchantLedgerRuleError,
  type MerchantPayment,
  type MerchantPaymentMethod,
  type SaleCondition,
  type SaleItemInput,
} from '../../domain/merchant/merchant-ledger.js';
import { businessDate } from '../../domain/merchant/business-date.js';

export class MerchantLedgerNotFoundError extends Error {
  constructor() { super('Merchant ledger record not found.'); this.name = 'MerchantLedgerNotFoundError'; }
}

type SaleLineRequest = {
  catalogItemId?: string | undefined;
  name?: string | undefined;
  kind?: 'product' | 'service' | 'other' | undefined;
  quantity: number;
  unitPriceMinor?: number | undefined;
};

type Dependencies = {
  directory: MerchantDirectoryRepository;
  ledger: MerchantLedgerRepository;
  generateId: () => string;
  clock: () => Date;
};

export function registerMerchantSale(input: {
  ownerUserId: string;
  customerId: string;
  items: SaleLineRequest[];
  condition: SaleCondition;
  downPaymentMinor?: number | undefined;
  initialPaymentMethod?: MerchantPaymentMethod | undefined;
  installmentCount?: number | undefined;
  firstDueDate?: string | undefined;
}, dependencies: Dependencies) {
  const customer = dependencies.directory.findCustomer(input.ownerUserId, input.customerId);
  if (!customer || customer.status !== 'active') throw new MerchantLedgerNotFoundError();

  const items: SaleItemInput[] = input.items.map((line) => {
    if (line.catalogItemId) {
      const catalogItem = dependencies.directory.findCatalogItem(input.ownerUserId, line.catalogItemId);
      if (!catalogItem || catalogItem.status !== 'active') throw new MerchantLedgerNotFoundError();
      return {
        catalogItemId: catalogItem.id,
        kind: catalogItem.kind,
        name: line.name?.trim() || catalogItem.name,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor ?? catalogItem.priceMinor,
      };
    }
    if (!line.name || !line.kind || line.unitPriceMinor === undefined) throw new MerchantLedgerRuleError('Adicione nome, tipo e valor ao item avulso.');
    return {
      name: line.name,
      kind: line.kind,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
    };
  });
  const calculatedTotal = items.reduce((sum, item) => sum + item.quantity * item.unitPriceMinor, 0);
  const downPaymentMinor = input.downPaymentMinor ?? (input.condition === 'cash' ? calculatedTotal : 0);
  const sale = createSale({
    id: dependencies.generateId(),
    ownerUserId: input.ownerUserId,
    customerId: customer.id,
    items,
    downPaymentMinor,
    condition: input.condition,
    ...(input.installmentCount === undefined ? {} : { installmentCount: input.installmentCount }),
    ...(input.firstDueDate === undefined ? {} : { firstDueDate: input.firstDueDate }),
    ...(input.initialPaymentMethod === undefined ? {} : { initialPaymentMethod: input.initialPaymentMethod }),
    now: dependencies.clock(),
  });
  dependencies.ledger.insertSale(sale);
  return sale;
}

export function getMerchantCustomerLedger(input: { ownerUserId: string; customerId: string }, dependencies: Dependencies) {
  const customer = dependencies.directory.findCustomer(input.ownerUserId, input.customerId);
  if (!customer) throw new MerchantLedgerNotFoundError();
  const today = businessDate(dependencies.clock());
  const sales = dependencies.ledger.getLedger(input.ownerUserId, input.customerId).map((sale) => ({
    ...sale,
    installments: sale.installments.map((installment) => {
      const payments = sale.payments.filter((payment) => payment.installmentId === installment.id);
      const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
      return {
        ...installment,
        paidMinor,
        balanceMinor: Math.max(0, installment.amountMinor - paidMinor),
        derivedStatus: getInstallmentStatus(installment, payments, today),
      };
    }),
    balanceMinor: getSaleBalance(sale, sale.payments),
  }));
  return { customer, sales };
}

export function recordMerchantInstallmentPayment(input: {
  ownerUserId: string;
  installmentId: string;
  amountMinor: number;
  method: MerchantPaymentMethod;
  reference?: string | undefined;
}, dependencies: Dependencies) {
  const installment = dependencies.ledger.findInstallment(input.ownerUserId, input.installmentId);
  if (!installment) throw new MerchantLedgerNotFoundError();
  const existingPayments = dependencies.ledger.listInstallmentPayments(input.ownerUserId, input.installmentId);
  const payment = registerInstallmentPayment({
    id: dependencies.generateId(),
    installment,
    existingPayments,
    amountMinor: input.amountMinor,
    method: input.method,
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    now: dependencies.clock(),
  });
  dependencies.ledger.insertPayment(payment);
  return payment;
}

export function getMerchantInstallmentMessageContext(input: { ownerUserId: string; installmentId: string }, dependencies: Dependencies) {
  const installment = dependencies.ledger.findInstallment(input.ownerUserId, input.installmentId);
  if (!installment) throw new MerchantLedgerNotFoundError();
  const customer = dependencies.directory.findCustomer(input.ownerUserId, installment.customerId);
  if (!customer) throw new MerchantLedgerNotFoundError();
  const ledger = dependencies.ledger.getLedger(input.ownerUserId, installment.customerId);
  const sale = ledger.find((item) => item.id === installment.saleId);
  if (!sale) throw new MerchantLedgerNotFoundError();
  const paidMinor = sale.payments.filter((payment) => payment.installmentId === installment.id)
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const balanceMinor = Math.max(0, installment.amountMinor - paidMinor);
  if (installment.status !== 'open' || balanceMinor <= 0) throw new MerchantLedgerRuleError('Esta parcela não possui saldo pendente para cobrar.');
  return {
    sourceType: 'sale_installment' as const,
    sourceId: installment.id,
    customerId: installment.customerId,
    customerName: customer.name,
    amountMinor: balanceMinor,
    dueDate: installment.dueDate,
    installmentNumber: installment.number,
    installmentTotal: sale.installments.length,
    itemNames: sale.items.map((item) => item.name),
  };
}

export function getMerchantLedgerOverview(input: { ownerUserId: string; upcomingDays?: number }, dependencies: Dependencies) {
  const today = businessDate(dependencies.clock());
  const until = new Date(`${today}T00:00:00.000Z`);
  until.setUTCDate(until.getUTCDate() + (input.upcomingDays ?? 14));
  const throughDate = until.toISOString().slice(0, 10);
  const commitments = dependencies.ledger.listCommitments({ ownerUserId: input.ownerUserId, throughDate });
  const attention = commitments.map((row) => {
    const paidMinor = row.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
    return {
      ...row,
      paidMinor,
      balanceMinor: Math.max(0, row.installment.amountMinor - paidMinor),
      derivedStatus: getInstallmentStatus(row.installment, row.payments, today),
    };
  }).filter((item) => item.balanceMinor > 0);
  const recentPayments = dependencies.ledger.listRecentPayments(input.ownerUserId, 8);
  return {
    customerCount: dependencies.directory.listCustomers({ ownerUserId: input.ownerUserId, status: 'all' }).length,
    saleCount: dependencies.ledger.countSales(input.ownerUserId),
    dueToday: attention.filter((item) => item.derivedStatus === 'due_today'),
    overdue: attention.filter((item) => item.derivedStatus === 'overdue'),
    upcoming: attention.filter((item) => item.installment.dueDate > today),
    recentPayments,
  };
}

export function serializeMerchantPayment(payment: MerchantPayment) {
  return { ...payment, paidAt: payment.paidAt.toISOString() };
}
