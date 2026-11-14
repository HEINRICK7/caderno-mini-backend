import { MerchantLedgerRuleError, type MerchantPaymentMethod } from './merchant-ledger.js';

export type RecurringFrequency = 'weekly' | 'fortnightly' | 'monthly';
export type RecurringPlanStatus = 'active' | 'paused' | 'ended';
export type RecurringChargeStatus = 'pending' | 'due_today' | 'overdue' | 'partially_paid' | 'paid' | 'canceled';

export type RecurringPlan = {
  id: string;
  ownerUserId: string;
  customerId: string;
  description: string;
  catalogItemId: string | null;
  frequency: RecurringFrequency;
  startDate: string;
  dueDay: number | null;
  endDate: string | null;
  totalCycles: number | null;
  status: RecurringPlanStatus;
  amountMinor: number;
};

export type RecurringCharge = {
  id: string;
  ownerUserId: string;
  customerId: string;
  planId: string;
  periodKey: string;
  amountMinor: number;
  dueDate: string;
  status: 'open' | 'canceled';
};

export type RecurringPayment = {
  id: string;
  ownerUserId: string;
  customerId: string;
  planId: string;
  chargeId: string;
  amountMinor: number;
  method: MerchantPaymentMethod;
  reference: string | null;
  paidAt: Date;
};

export function generateRecurringOccurrences(input: {
  plan: RecurringPlan;
  throughDate: string;
  now: Date;
  rateChanges?: Array<{ effectiveDate: string; amountMinor: number }> | undefined;
  pauses?: Array<{ startDate: string; endDate: string | null }> | undefined;
}): Array<Omit<RecurringCharge, 'id' | 'ownerUserId' | 'customerId' | 'planId' | 'status'>> {
  const { plan } = input;
  if (plan.status !== 'active') return [];
  assertIsoDate(input.throughDate);
  assertIsoDate(plan.startDate);
  if (plan.endDate) assertIsoDate(plan.endDate);
  if (!Number.isSafeInteger(plan.amountMinor) || plan.amountMinor < 0) throw new MerchantLedgerRuleError('Recurring amount is invalid.');
  if (plan.frequency === 'monthly' && (!Number.isInteger(plan.dueDay) || plan.dueDay! < 1 || plan.dueDay! > 31)) {
    throw new MerchantLedgerRuleError('Monthly due day must be from 1 to 31.');
  }
  const changes = [...(input.rateChanges ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  changes.forEach((change) => {
    assertIsoDate(change.effectiveDate);
    if (!Number.isSafeInteger(change.amountMinor) || change.amountMinor < 0) throw new MerchantLedgerRuleError('Recurring amount is invalid.');
  });
  const pauses = input.pauses ?? [];
  const limit = plan.totalCycles ?? 120;
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) throw new MerchantLedgerRuleError('Recurring cycle count is invalid.');

  const occurrences: Array<Omit<RecurringCharge, 'id' | 'ownerUserId' | 'customerId' | 'planId' | 'status'>> = [];
  for (let index = 0; index < 120 && occurrences.length < limit; index += 1) {
    const dueDate = occurrenceDate(plan, index);
    if (dueDate > input.throughDate) break;
    if (plan.endDate && dueDate > plan.endDate) break;
    const paused = pauses.some((pause) => dueDate >= pause.startDate && (pause.endDate === null || dueDate <= pause.endDate));
    if (paused) continue;
    const periodKey = plan.frequency === 'monthly' ? dueDate.slice(0, 7) : dueDate;
    let amountMinor = plan.amountMinor;
    for (const change of changes) {
      if (change.effectiveDate <= dueDate) amountMinor = change.amountMinor;
      else break;
    }
    occurrences.push({ periodKey, dueDate, amountMinor });
  }
  return occurrences;
}

export function getRecurringChargeStatus(charge: Pick<RecurringCharge, 'status' | 'amountMinor' | 'dueDate'>, paidMinor: number, today: string): RecurringChargeStatus {
  if (charge.status === 'canceled') return 'canceled';
  if (paidMinor >= charge.amountMinor) return 'paid';
  if (paidMinor > 0) return 'partially_paid';
  assertIsoDate(today);
  if (charge.dueDate < today) return 'overdue';
  if (charge.dueDate === today) return 'due_today';
  return 'pending';
}

export function registerRecurringChargePayment(input: {
  id: string;
  charge: RecurringCharge;
  existingPaidMinor: number;
  amountMinor: number;
  method: MerchantPaymentMethod;
  reference?: string | undefined;
  now: Date;
}): RecurringPayment {
  if (input.charge.status !== 'open') throw new MerchantLedgerRuleError('Canceled recurring charges cannot be paid.');
  const balance = input.charge.amountMinor - input.existingPaidMinor;
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > balance) {
    throw new MerchantLedgerRuleError('Payment amount exceeds the remaining recurring balance.');
  }
  const reference = input.reference?.trim();
  return {
    id: input.id,
    ownerUserId: input.charge.ownerUserId,
    customerId: input.charge.customerId,
    planId: input.charge.planId,
    chargeId: input.charge.id,
    amountMinor: input.amountMinor,
    method: input.method,
    reference: reference ? reference.slice(0, 240) : null,
    paidAt: input.now,
  };
}

export function occurrenceDate(plan: Pick<RecurringPlan, 'frequency' | 'startDate' | 'dueDay'>, index: number): string {
  const start = parseIsoDate(plan.startDate);
  if (plan.frequency === 'weekly' || plan.frequency === 'fortnightly') {
    return addDays(start, index * (plan.frequency === 'weekly' ? 7 : 14));
  }
  if (!Number.isInteger(plan.dueDay) || plan.dueDay! < 1 || plan.dueDay! > 31) {
    throw new MerchantLedgerRuleError('Monthly due day must be from 1 to 31.');
  }
  const firstCandidate = monthDate(start.getUTCFullYear(), start.getUTCMonth(), plan.dueDay!);
  const first = firstCandidate >= plan.startDate ? 0 : 1;
  return monthDate(start.getUTCFullYear(), start.getUTCMonth() + first + index, plan.dueDay!);
}

function monthDate(year: number, month: number, requestedDay: number): string {
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(requestedDay, lastDay))).toISOString().slice(0, 10);
}

function addDays(date: Date, count: number): string {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MerchantLedgerRuleError('Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.toISOString().slice(0, 10) !== value) throw new MerchantLedgerRuleError('Date is invalid.');
  return date;
}

function assertIsoDate(value: string): void { parseIsoDate(value); }
