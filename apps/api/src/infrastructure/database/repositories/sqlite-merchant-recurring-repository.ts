import { and, asc, desc, eq, gte, isNull, notExists } from 'drizzle-orm';

import type { MerchantRecurringRepository, MerchantRecurringChargeRecord, MerchantRecurringPlanRecord, MerchantRecurringRate, MerchantRecurringPause } from '../../../application/ports/merchant-recurring-repository.js';
import type { RecurringCharge, RecurringPayment, RecurringPlanStatus } from '../../../domain/merchant/merchant-recurring.js';
import type { AppDatabase } from '../connection.js';
import {
  merchantCustomers,
  merchantRecurringCharges,
  merchantRecurringPauses,
  merchantRecurringPayments,
  merchantRecurringPlans,
  merchantRecurringRates,
} from '../schema.js';

export class SqliteMerchantRecurringRepository implements MerchantRecurringRepository {
  constructor(private readonly db: AppDatabase) {}

  insertPlan(plan: MerchantRecurringPlanRecord, initialRateId: string): void {
    this.db.transaction((tx) => {
      tx.insert(merchantRecurringPlans).values(plan).run();
      tx.insert(merchantRecurringRates).values({
        id: initialRateId,
        ownerUserId: plan.ownerUserId,
        planId: plan.id,
        effectiveDate: plan.startDate,
        amountMinor: plan.amountMinor,
        createdAt: plan.createdAt,
      }).run();
    });
  }

  listPlans(ownerUserId: string, status: RecurringPlanStatus | 'all' = 'all'): MerchantRecurringPlanRecord[] {
    return this.db.select().from(merchantRecurringPlans).where(and(
      eq(merchantRecurringPlans.ownerUserId, ownerUserId),
      status === 'all' ? undefined : eq(merchantRecurringPlans.status, status),
    )).orderBy(desc(merchantRecurringPlans.updatedAt)).all();
  }

  listAllActivePlans(): MerchantRecurringPlanRecord[] {
    return this.db.select().from(merchantRecurringPlans).where(eq(merchantRecurringPlans.status, 'active')).all();
  }

  findPlan(ownerUserId: string, id: string): MerchantRecurringPlanRecord | undefined {
    return this.db.select().from(merchantRecurringPlans).where(and(
      eq(merchantRecurringPlans.ownerUserId, ownerUserId), eq(merchantRecurringPlans.id, id),
    )).get();
  }

  updatePlan(ownerUserId: string, id: string, patch: Partial<Pick<MerchantRecurringPlanRecord, 'amountMinor' | 'status' | 'endDate' | 'updatedAt'>>): boolean {
    const result = this.db.update(merchantRecurringPlans).set(patch).where(and(
      eq(merchantRecurringPlans.ownerUserId, ownerUserId), eq(merchantRecurringPlans.id, id),
    )).run();
    return result.changes > 0;
  }

  listRates(ownerUserId: string, planId: string): MerchantRecurringRate[] {
    return this.db.select({ effectiveDate: merchantRecurringRates.effectiveDate, amountMinor: merchantRecurringRates.amountMinor })
      .from(merchantRecurringRates).where(and(
        eq(merchantRecurringRates.ownerUserId, ownerUserId), eq(merchantRecurringRates.planId, planId),
      )).orderBy(asc(merchantRecurringRates.effectiveDate)).all();
  }

  listPauses(ownerUserId: string, planId: string): MerchantRecurringPause[] {
    return this.db.select({ startDate: merchantRecurringPauses.startDate, endDate: merchantRecurringPauses.endDate })
      .from(merchantRecurringPauses).where(and(
        eq(merchantRecurringPauses.ownerUserId, ownerUserId), eq(merchantRecurringPauses.planId, planId),
      )).orderBy(asc(merchantRecurringPauses.startDate)).all();
  }

  addRate(input: { id: string; ownerUserId: string; planId: string; effectiveDate: string; amountMinor: number; createdAt: Date }): void {
    this.db.transaction((tx) => {
      tx.insert(merchantRecurringRates).values(input).run();
      tx.update(merchantRecurringCharges).set({ amountMinor: input.amountMinor }).where(and(
        eq(merchantRecurringCharges.ownerUserId, input.ownerUserId),
        eq(merchantRecurringCharges.planId, input.planId),
        eq(merchantRecurringCharges.status, 'open'),
        gte(merchantRecurringCharges.dueDate, input.effectiveDate),
        notExists(tx.select({ id: merchantRecurringPayments.id }).from(merchantRecurringPayments).where(and(
          eq(merchantRecurringPayments.chargeId, merchantRecurringCharges.id),
          eq(merchantRecurringPayments.ownerUserId, input.ownerUserId),
        ))),
      )).run();
    });
  }

  pausePlan(input: { ownerUserId: string; planId: string; pauseId: string; today: string; now: Date }): void {
    this.db.transaction((tx) => {
      tx.update(merchantRecurringPlans).set({ status: 'paused', updatedAt: input.now }).where(and(
        eq(merchantRecurringPlans.ownerUserId, input.ownerUserId), eq(merchantRecurringPlans.id, input.planId),
      )).run();
      tx.insert(merchantRecurringPauses).values({
        id: input.pauseId, ownerUserId: input.ownerUserId, planId: input.planId,
        startDate: input.today, endDate: null, createdAt: input.now,
      }).run();
      tx.update(merchantRecurringCharges).set({ status: 'canceled' }).where(and(
        eq(merchantRecurringCharges.ownerUserId, input.ownerUserId),
        eq(merchantRecurringCharges.planId, input.planId),
        eq(merchantRecurringCharges.status, 'open'),
        gte(merchantRecurringCharges.dueDate, input.today),
      )).run();
    });
  }

  resumePlan(input: { ownerUserId: string; planId: string; today: string; now: Date }): void {
    this.db.transaction((tx) => {
      tx.update(merchantRecurringPlans).set({ status: 'active', updatedAt: input.now }).where(and(
        eq(merchantRecurringPlans.ownerUserId, input.ownerUserId), eq(merchantRecurringPlans.id, input.planId),
      )).run();
      tx.update(merchantRecurringPauses).set({ endDate: input.today }).where(and(
        eq(merchantRecurringPauses.ownerUserId, input.ownerUserId), eq(merchantRecurringPauses.planId, input.planId),
        isNull(merchantRecurringPauses.endDate),
      )).run();
      tx.update(merchantRecurringCharges).set({ status: 'open' }).where(and(
        eq(merchantRecurringCharges.ownerUserId, input.ownerUserId),
        eq(merchantRecurringCharges.planId, input.planId),
        eq(merchantRecurringCharges.status, 'canceled'),
        gte(merchantRecurringCharges.dueDate, input.today),
      )).run();
    });
  }

  endPlan(input: { ownerUserId: string; planId: string; today: string; now: Date }): void {
    this.db.transaction((tx) => {
      tx.update(merchantRecurringPlans).set({ status: 'ended', endDate: input.today, updatedAt: input.now }).where(and(
        eq(merchantRecurringPlans.ownerUserId, input.ownerUserId), eq(merchantRecurringPlans.id, input.planId),
      )).run();
      tx.update(merchantRecurringPauses).set({ endDate: input.today }).where(and(
        eq(merchantRecurringPauses.ownerUserId, input.ownerUserId), eq(merchantRecurringPauses.planId, input.planId),
        isNull(merchantRecurringPauses.endDate),
      )).run();
      tx.update(merchantRecurringCharges).set({ status: 'canceled' }).where(and(
        eq(merchantRecurringCharges.ownerUserId, input.ownerUserId),
        eq(merchantRecurringCharges.planId, input.planId),
        eq(merchantRecurringCharges.status, 'open'),
        gte(merchantRecurringCharges.dueDate, input.today),
      )).run();
    });
  }

  insertCharges(input: {
    ownerUserId: string;
    plan: MerchantRecurringPlanRecord;
    charges: Array<{ periodKey: string; dueDate: string; amountMinor: number }>;
    generateId: () => string;
  }): number {
    if (!input.charges.length) return 0;
    let inserted = 0;
    this.db.transaction((tx) => {
      for (const charge of input.charges) {
        inserted += tx.insert(merchantRecurringCharges).values({
          id: input.generateId(),
          ownerUserId: input.ownerUserId,
          customerId: input.plan.customerId,
          planId: input.plan.id,
          periodKey: charge.periodKey,
          amountMinor: charge.amountMinor,
          dueDate: charge.dueDate,
          status: 'open',
        }).onConflictDoNothing({ target: [merchantRecurringCharges.planId, merchantRecurringCharges.periodKey] }).run().changes;
      }
    });
    return inserted;
  }

  listCharges(input: { ownerUserId: string; planId?: string; customerId?: string }): MerchantRecurringChargeRecord[] {
    const rows = this.db.select({
      charge: merchantRecurringCharges,
      description: merchantRecurringPlans.description,
      frequency: merchantRecurringPlans.frequency,
      customer: { id: merchantCustomers.id, name: merchantCustomers.name, whatsapp: merchantCustomers.whatsapp },
    }).from(merchantRecurringCharges)
      .innerJoin(merchantRecurringPlans, and(
        eq(merchantRecurringPlans.id, merchantRecurringCharges.planId),
        eq(merchantRecurringPlans.ownerUserId, input.ownerUserId),
      ))
      .innerJoin(merchantCustomers, and(
        eq(merchantCustomers.id, merchantRecurringCharges.customerId),
        eq(merchantCustomers.ownerUserId, input.ownerUserId),
      ))
      .where(and(
        eq(merchantRecurringCharges.ownerUserId, input.ownerUserId),
        input.planId ? eq(merchantRecurringCharges.planId, input.planId) : undefined,
        input.customerId ? eq(merchantRecurringCharges.customerId, input.customerId) : undefined,
      )).orderBy(desc(merchantRecurringCharges.dueDate)).all();
    return rows.map(({ charge, description, frequency, customer }) => ({
      ...charge,
      description,
      frequency,
      customer,
      payments: this.listChargePayments(input.ownerUserId, charge.id),
    }));
  }

  findCharge(ownerUserId: string, chargeId: string): RecurringCharge | undefined {
    return this.db.select().from(merchantRecurringCharges).where(and(
      eq(merchantRecurringCharges.ownerUserId, ownerUserId), eq(merchantRecurringCharges.id, chargeId),
    )).get();
  }

  findPayment(ownerUserId: string, paymentId: string): RecurringPayment | undefined {
    return this.db.select().from(merchantRecurringPayments).where(and(
      eq(merchantRecurringPayments.ownerUserId, ownerUserId), eq(merchantRecurringPayments.id, paymentId),
    )).get();
  }

  insertPayment(payment: RecurringPayment): void {
    this.db.insert(merchantRecurringPayments).values(payment).run();
  }

  listChargePayments(ownerUserId: string, chargeId: string): RecurringPayment[] {
    return this.db.select().from(merchantRecurringPayments).where(and(
      eq(merchantRecurringPayments.ownerUserId, ownerUserId), eq(merchantRecurringPayments.chargeId, chargeId),
    )).orderBy(asc(merchantRecurringPayments.paidAt)).all();
  }
}
