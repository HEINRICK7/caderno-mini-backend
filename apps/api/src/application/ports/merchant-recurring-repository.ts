import type { RecurringCharge, RecurringFrequency, RecurringPayment, RecurringPlan, RecurringPlanStatus } from '../../domain/merchant/merchant-recurring.js';

export type MerchantRecurringPlanRecord = RecurringPlan & { createdAt: Date; updatedAt: Date };
export type MerchantRecurringRate = { effectiveDate: string; amountMinor: number };
export type MerchantRecurringPause = { startDate: string; endDate: string | null };
export type MerchantRecurringChargeRecord = RecurringCharge & {
  description: string;
  frequency: RecurringFrequency;
  customer: { id: string; name: string; whatsapp: string | null };
  payments: RecurringPayment[];
};

export type MerchantRecurringRepository = {
  insertPlan(plan: MerchantRecurringPlanRecord, initialRateId: string): void;
  listPlans(ownerUserId: string, status?: RecurringPlanStatus | 'all'): MerchantRecurringPlanRecord[];
  listAllActivePlans(): MerchantRecurringPlanRecord[];
  findPlan(ownerUserId: string, id: string): MerchantRecurringPlanRecord | undefined;
  updatePlan(ownerUserId: string, id: string, patch: Partial<Pick<MerchantRecurringPlanRecord, 'amountMinor' | 'status' | 'endDate' | 'updatedAt'>>): boolean;
  listRates(ownerUserId: string, planId: string): MerchantRecurringRate[];
  listPauses(ownerUserId: string, planId: string): MerchantRecurringPause[];
  addRate(input: { id: string; ownerUserId: string; planId: string; effectiveDate: string; amountMinor: number; createdAt: Date }): void;
  pausePlan(input: { ownerUserId: string; planId: string; pauseId: string; today: string; now: Date }): void;
  resumePlan(input: { ownerUserId: string; planId: string; today: string; now: Date }): void;
  endPlan(input: { ownerUserId: string; planId: string; today: string; now: Date }): void;
  insertCharges(input: { ownerUserId: string; plan: MerchantRecurringPlanRecord; charges: Array<{ periodKey: string; dueDate: string; amountMinor: number }>; generateId: () => string }): number;
  listCharges(input: { ownerUserId: string; planId?: string; customerId?: string }): MerchantRecurringChargeRecord[];
  findCharge(ownerUserId: string, chargeId: string): RecurringCharge | undefined;
  findPayment(ownerUserId: string, paymentId: string): RecurringPayment | undefined;
  insertPayment(payment: RecurringPayment): void;
  listChargePayments(ownerUserId: string, chargeId: string): RecurringPayment[];
};
