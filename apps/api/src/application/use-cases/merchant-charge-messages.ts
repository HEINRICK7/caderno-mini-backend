import type { DraftRepository } from '../ports/draft-repository.js';
import type { MerchantChargeMessageRepository, MerchantChargeSourceType } from '../ports/merchant-charge-message-repository.js';
import type { MerchantDirectoryRepository } from '../ports/merchant-directory-repository.js';
import type { MerchantLedgerRepository } from '../ports/merchant-ledger-repository.js';
import type { MerchantRecurringRepository } from '../ports/merchant-recurring-repository.js';
import { MerchantLedgerNotFoundError } from './merchant-ledger.js';

export class MerchantChargeMessageConflictError extends Error {
  constructor() {
    super('Este rascunho já está associado a outra cobrança.');
    this.name = 'MerchantChargeMessageConflictError';
  }
}

type Dependencies = {
  drafts: DraftRepository;
  directory: MerchantDirectoryRepository;
  ledger: MerchantLedgerRepository;
  recurring: MerchantRecurringRepository;
  messages: MerchantChargeMessageRepository;
  generateId: () => string;
  clock: () => Date;
};

export function linkMerchantChargeMessage(input: {
  ownerUserId: string;
  sourceType: MerchantChargeSourceType;
  sourceId: string;
  draftId: string;
}, dependencies: Dependencies) {
  const draft = dependencies.drafts.findByIdForUser(input.draftId, input.ownerUserId);
  if (!draft) throw new MerchantLedgerNotFoundError();

  let sourceCustomerId: string | undefined;
  switch (input.sourceType) {
    case 'sale':
      sourceCustomerId = dependencies.ledger.findSale(input.ownerUserId, input.sourceId)?.customerId;
      break;
    case 'sale_installment':
      sourceCustomerId = dependencies.ledger.findInstallment(input.ownerUserId, input.sourceId)?.customerId;
      break;
    case 'sale_payment':
      sourceCustomerId = dependencies.ledger.findPayment(input.ownerUserId, input.sourceId)?.customerId;
      break;
    case 'recurring_charge':
      sourceCustomerId = dependencies.recurring.findCharge(input.ownerUserId, input.sourceId)?.customerId;
      break;
    case 'recurring_payment':
      sourceCustomerId = dependencies.recurring.findPayment(input.ownerUserId, input.sourceId)?.customerId;
      break;
  }
  if (!sourceCustomerId) throw new MerchantLedgerNotFoundError();
  const customer = dependencies.directory.findCustomer(input.ownerUserId, sourceCustomerId);
  if (!customer) throw new MerchantLedgerNotFoundError();

  const existing = dependencies.messages.insertOrGet({
    id: dependencies.generateId(),
    ownerUserId: input.ownerUserId,
    customerId: customer.id,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    draftId: draft.id,
    createdAt: dependencies.clock(),
  });
  if (
    existing.ownerUserId !== input.ownerUserId || existing.customerId !== customer.id ||
    existing.sourceType !== input.sourceType || existing.sourceId !== input.sourceId
  ) throw new MerchantChargeMessageConflictError();
  return existing;
}

export function getMerchantSaleMessageContext(input: { ownerUserId: string; saleId: string }, dependencies: Dependencies) {
  const sale = dependencies.ledger.findSale(input.ownerUserId, input.saleId);
  if (!sale) throw new MerchantLedgerNotFoundError();
  const customer = dependencies.directory.findCustomer(input.ownerUserId, sale.customerId);
  if (!customer) throw new MerchantLedgerNotFoundError();
  return {
    sourceType: 'sale' as const,
    sourceId: sale.id,
    customerId: customer.id,
    customerName: customer.name,
    amountMinor: sale.totalMinor,
    dueDate: null,
    installmentNumber: null,
    installmentTotal: null,
    itemNames: sale.items.map((item) => item.name),
    paidAt: null,
  };
}

export function getMerchantPaymentMessageContext(input: {
  ownerUserId: string;
  paymentType: 'sale_payment' | 'recurring_payment';
  paymentId: string;
}, dependencies: Dependencies) {
  if (input.paymentType === 'sale_payment') {
    const payment = dependencies.ledger.findPayment(input.ownerUserId, input.paymentId);
    if (!payment) throw new MerchantLedgerNotFoundError();
    const sale = dependencies.ledger.findSale(input.ownerUserId, payment.saleId);
    const customer = dependencies.directory.findCustomer(input.ownerUserId, payment.customerId);
    if (!sale || !customer) throw new MerchantLedgerNotFoundError();
    const installment = sale.installments.find((item) => item.id === payment.installmentId);
    return {
      sourceType: 'sale_payment' as const,
      sourceId: payment.id,
      customerId: customer.id,
      customerName: customer.name,
      amountMinor: payment.amountMinor,
      dueDate: null,
      installmentNumber: installment?.number ?? null,
      installmentTotal: installment ? sale.installments.length : null,
      itemNames: sale.items.map((item) => item.name),
      paidAt: payment.paidAt.toISOString().slice(0, 10),
    };
  }

  const payment = dependencies.recurring.findPayment(input.ownerUserId, input.paymentId);
  if (!payment) throw new MerchantLedgerNotFoundError();
  const plan = dependencies.recurring.findPlan(input.ownerUserId, payment.planId);
  const customer = dependencies.directory.findCustomer(input.ownerUserId, payment.customerId);
  if (!plan || !customer) throw new MerchantLedgerNotFoundError();
  return {
    sourceType: 'recurring_payment' as const,
    sourceId: payment.id,
    customerId: customer.id,
    customerName: customer.name,
    amountMinor: payment.amountMinor,
    dueDate: null,
    installmentNumber: null,
    installmentTotal: null,
    itemNames: [plan.description],
    paidAt: payment.paidAt.toISOString().slice(0, 10),
  };
}

export function listMerchantChargeMessages(input: { ownerUserId: string; customerId: string }, dependencies: Dependencies) {
  const customer = dependencies.directory.findCustomer(input.ownerUserId, input.customerId);
  if (!customer) throw new MerchantLedgerNotFoundError();
  return dependencies.messages.listForCustomer(input.ownerUserId, customer.id);
}
