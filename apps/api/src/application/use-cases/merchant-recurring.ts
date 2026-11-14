import type { MerchantDirectoryRepository } from '../ports/merchant-directory-repository.js';
import type { MerchantRecurringRepository, MerchantRecurringPlanRecord } from '../ports/merchant-recurring-repository.js';
import {
  generateRecurringOccurrences,
  getRecurringChargeStatus,
  registerRecurringChargePayment,
  type RecurringFrequency,
  type RecurringPlanStatus,
  type RecurringPayment,
} from '../../domain/merchant/merchant-recurring.js';
import { MerchantLedgerNotFoundError } from './merchant-ledger.js';
import { MerchantLedgerRuleError } from '../../domain/merchant/merchant-ledger.js';
import { businessDate } from '../../domain/merchant/business-date.js';

type Dependencies = {
  directory: MerchantDirectoryRepository;
  recurring: MerchantRecurringRepository;
  generateId: () => string;
  clock: () => Date;
};

export function createMerchantRecurringPlan(input: {
  ownerUserId: string;
  customerId: string;
  description?: string | undefined;
  catalogItemId?: string | undefined;
  amountMinor?: number | undefined;
  frequency: RecurringFrequency;
  startDate: string;
  dueDay?: number | undefined;
  endDate?: string | undefined;
  totalCycles?: number | undefined;
}, dependencies: Dependencies) {
  const customer = dependencies.directory.findCustomer(input.ownerUserId, input.customerId);
  if (!customer || customer.status !== 'active') throw new MerchantLedgerNotFoundError();
  const catalogItem = input.catalogItemId
    ? dependencies.directory.findCatalogItem(input.ownerUserId, input.catalogItemId)
    : undefined;
  if (input.catalogItemId && (!catalogItem || catalogItem.status !== 'active')) throw new MerchantLedgerNotFoundError();
  const description = input.description?.trim() || catalogItem?.name || '';
  if (description.length < 2 || description.length > 160) throw new MerchantLedgerRuleError('Informe uma descrição entre 2 e 160 caracteres.');
  const amountMinor = input.amountMinor ?? catalogItem?.priceMinor;
  if (amountMinor === undefined) throw new MerchantLedgerRuleError('Informe o valor da cobrança.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 99_999_999) throw new MerchantLedgerRuleError('O valor da cobrança é inválido.');
  if (input.frequency === 'monthly' && (!Number.isInteger(input.dueDay) || input.dueDay! < 1 || input.dueDay! > 31)) {
    throw new MerchantLedgerRuleError('Informe um dia de vencimento entre 1 e 31.');
  }
  const now = dependencies.clock();
  const plan: MerchantRecurringPlanRecord = {
    id: dependencies.generateId(),
    ownerUserId: input.ownerUserId,
    customerId: customer.id,
    description,
    catalogItemId: catalogItem?.id ?? null,
    amountMinor,
    frequency: input.frequency,
    startDate: input.startDate,
    dueDay: input.frequency === 'monthly' ? input.dueDay! : null,
    endDate: input.endDate ?? null,
    totalCycles: input.totalCycles ?? null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  // Run the domain schedule once so malformed date and cycle inputs never enter storage.
  generateRecurringOccurrences({ plan, throughDate: input.startDate, now });
  dependencies.recurring.insertPlan(plan, dependencies.generateId());
  return plan;
}

export function generateMerchantRecurringCharges(input: { ownerUserId?: string | undefined; throughDate?: string | undefined }, dependencies: Dependencies): number {
  const today = businessDate(dependencies.clock());
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 90);
  const throughDate = input.throughDate ?? horizon.toISOString().slice(0, 10);
  const plans = input.ownerUserId
    ? dependencies.recurring.listPlans(input.ownerUserId, 'active')
    : dependencies.recurring.listAllActivePlans();
  return plans.reduce((total, plan) => {
    const occurrences = generateRecurringOccurrences({
      plan,
      throughDate,
      now: dependencies.clock(),
      rateChanges: dependencies.recurring.listRates(plan.ownerUserId, plan.id),
      pauses: dependencies.recurring.listPauses(plan.ownerUserId, plan.id),
    });
    return total + dependencies.recurring.insertCharges({
      ownerUserId: plan.ownerUserId,
      plan,
      charges: occurrences,
      generateId: dependencies.generateId,
    });
  }, 0);
}

export function listMerchantRecurringPlans(input: { ownerUserId: string; status?: RecurringPlanStatus | 'all' }, dependencies: Dependencies) {
  generateMerchantRecurringCharges({ ownerUserId: input.ownerUserId }, dependencies);
  const plans = dependencies.recurring.listPlans(input.ownerUserId, input.status ?? 'all');
  const charges = dependencies.recurring.listCharges({ ownerUserId: input.ownerUserId });
  return plans.map((plan) => {
    const rates = dependencies.recurring.listRates(input.ownerUserId, plan.id);
    return {
      ...plan,
      currentAmountMinor: rates.at(-1)?.amountMinor ?? plan.amountMinor,
      rates,
      pauses: dependencies.recurring.listPauses(input.ownerUserId, plan.id),
      charges: charges.filter((charge) => charge.planId === plan.id).map((charge) => presentCharge(charge, dependencies.clock())),
    };
  });
}

export function changeMerchantRecurringRate(input: {
  ownerUserId: string;
  planId: string;
  effectiveDate: string;
  amountMinor: number;
}, dependencies: Dependencies) {
  const plan = dependencies.recurring.findPlan(input.ownerUserId, input.planId);
  if (!plan || plan.status === 'ended') throw new MerchantLedgerNotFoundError();
  const today = businessDate(dependencies.clock());
  if (input.effectiveDate < today || input.effectiveDate < plan.startDate) throw new MerchantLedgerRuleError('A vigência deve começar hoje ou em uma data futura.');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 1 || input.amountMinor > 99_999_999) throw new MerchantLedgerRuleError('O valor da cobrança é inválido.');
  dependencies.recurring.addRate({
    id: dependencies.generateId(), ownerUserId: input.ownerUserId, planId: plan.id,
    effectiveDate: input.effectiveDate, amountMinor: input.amountMinor, createdAt: dependencies.clock(),
  });
  return dependencies.recurring.listRates(input.ownerUserId, input.planId);
}

export function pauseMerchantRecurringPlan(input: { ownerUserId: string; planId: string }, dependencies: Dependencies): void {
  const plan = dependencies.recurring.findPlan(input.ownerUserId, input.planId);
  if (!plan || plan.status !== 'active') throw new MerchantLedgerNotFoundError();
  const now = dependencies.clock();
  dependencies.recurring.pausePlan({ ownerUserId: input.ownerUserId, planId: plan.id, pauseId: dependencies.generateId(), today: businessDate(now), now });
}

export function resumeMerchantRecurringPlan(input: { ownerUserId: string; planId: string }, dependencies: Dependencies): void {
  const plan = dependencies.recurring.findPlan(input.ownerUserId, input.planId);
  if (!plan || plan.status !== 'paused') throw new MerchantLedgerNotFoundError();
  const now = dependencies.clock();
  dependencies.recurring.resumePlan({ ownerUserId: input.ownerUserId, planId: plan.id, today: businessDate(now), now });
  generateMerchantRecurringCharges({ ownerUserId: input.ownerUserId }, dependencies);
}

export function endMerchantRecurringPlan(input: { ownerUserId: string; planId: string }, dependencies: Dependencies): void {
  const plan = dependencies.recurring.findPlan(input.ownerUserId, input.planId);
  if (!plan || plan.status === 'ended') throw new MerchantLedgerNotFoundError();
  const now = dependencies.clock();
  dependencies.recurring.endPlan({ ownerUserId: input.ownerUserId, planId: plan.id, today: businessDate(now), now });
}

export function recordMerchantRecurringPayment(input: {
  ownerUserId: string;
  chargeId: string;
  amountMinor: number;
  method: RecurringPayment['method'];
  reference?: string | undefined;
}, dependencies: Dependencies) {
  const charge = dependencies.recurring.findCharge(input.ownerUserId, input.chargeId);
  if (!charge) throw new MerchantLedgerNotFoundError();
  const payments = dependencies.recurring.listChargePayments(input.ownerUserId, charge.id);
  const payment = registerRecurringChargePayment({
    id: dependencies.generateId(), charge,
    existingPaidMinor: payments.reduce((sum, item) => sum + item.amountMinor, 0),
    amountMinor: input.amountMinor,
    method: input.method,
    ...(input.reference === undefined ? {} : { reference: input.reference }),
    now: dependencies.clock(),
  });
  dependencies.recurring.insertPayment(payment);
  return payment;
}

export function getMerchantRecurringChargeMessageContext(input: { ownerUserId: string; chargeId: string }, dependencies: Dependencies) {
  const charge = dependencies.recurring.findCharge(input.ownerUserId, input.chargeId);
  if (!charge) throw new MerchantLedgerNotFoundError();
  const customer = dependencies.directory.findCustomer(input.ownerUserId, charge.customerId);
  const plan = dependencies.recurring.findPlan(input.ownerUserId, charge.planId);
  if (!customer || !plan) throw new MerchantLedgerNotFoundError();
  const payments = dependencies.recurring.listChargePayments(input.ownerUserId, charge.id);
  const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  const balanceMinor = Math.max(0, charge.amountMinor - paidMinor);
  const status = getRecurringChargeStatus(charge, paidMinor, businessDate(dependencies.clock()));
  if (status === 'paid' || status === 'canceled' || balanceMinor <= 0) throw new MerchantLedgerRuleError('Esta cobrança não possui saldo pendente para cobrar.');
  return {
    sourceType: 'recurring_charge' as const,
    sourceId: charge.id,
    customerId: customer.id,
    customerName: customer.name,
    amountMinor: balanceMinor,
    dueDate: charge.dueDate,
    installmentNumber: null,
    installmentTotal: null,
    itemNames: [plan.description],
  };
}

export function listMerchantRecurringCharges(input: { ownerUserId: string; planId?: string; customerId?: string }, dependencies: Dependencies) {
  generateMerchantRecurringCharges({ ownerUserId: input.ownerUserId }, dependencies);
  return dependencies.recurring.listCharges(input).map((charge) => presentCharge(charge, dependencies.clock()));
}

export function getMerchantRecurringOverview(input: { ownerUserId: string }, dependencies: Dependencies) {
  const today = businessDate(dependencies.clock());
  const charges = listMerchantRecurringCharges(input, dependencies);
  return {
    activePlanCount: dependencies.recurring.listPlans(input.ownerUserId, 'active').length,
    dueToday: charges.filter((charge) => charge.derivedStatus === 'due_today'),
    overdue: charges.filter((charge) => charge.derivedStatus === 'overdue'),
    upcoming: charges.filter((charge) => charge.status === 'open' && charge.dueDate > today && charge.dueDate <= addDays(today, 14) && charge.balanceMinor > 0),
  };
}

function presentCharge(charge: ReturnType<MerchantRecurringRepository['listCharges']>[number], now: Date) {
  const paidMinor = charge.payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  return {
    id: charge.id,
    ownerUserId: charge.ownerUserId,
    customerId: charge.customerId,
    planId: charge.planId,
    periodKey: charge.periodKey,
    amountMinor: charge.amountMinor,
    dueDate: charge.dueDate,
    status: charge.status,
    description: charge.description,
    frequency: charge.frequency,
    customer: charge.customer,
    payments: charge.payments,
    paidMinor,
    balanceMinor: Math.max(0, charge.amountMinor - paidMinor),
    derivedStatus: getRecurringChargeStatus(charge, paidMinor, businessDate(now)),
  };
}

function addDays(isoDate: string, count: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
