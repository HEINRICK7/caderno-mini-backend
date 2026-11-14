export type SaleCondition = 'cash' | 'single_due' | 'installments';
export type MerchantPaymentMethod = 'pix' | 'cash' | 'bank_transfer' | 'other';
export type InstallmentStatus = 'pending' | 'due_today' | 'overdue' | 'partially_paid' | 'paid' | 'canceled';

export class MerchantLedgerRuleError extends Error {
  constructor(message: string) { super(message); this.name = 'MerchantLedgerRuleError'; }
}

export type SaleItemInput = {
  catalogItemId?: string | undefined;
  kind: 'product' | 'service' | 'other';
  name: string;
  quantity: number;
  unitPriceMinor: number;
};

export type SaleItem = Omit<SaleItemInput, 'catalogItemId'> & { catalogItemId: string | null; id: string; lineTotalMinor: number };
export type SaleInstallment = {
  id: string;
  ownerUserId: string;
  saleId: string;
  customerId: string;
  number: number;
  amountMinor: number;
  dueDate: string;
  status: 'open' | 'canceled';
};

export type MerchantPayment = {
  id: string;
  ownerUserId: string;
  customerId: string;
  saleId: string;
  installmentId: string | null;
  amountMinor: number;
  method: MerchantPaymentMethod;
  reference: string | null;
  paidAt: Date;
};

export type MerchantSale = {
  id: string;
  ownerUserId: string;
  customerId: string;
  condition: SaleCondition;
  totalMinor: number;
  downPaymentMinor: number;
  financedMinor: number;
  items: SaleItem[];
  installments: SaleInstallment[];
  initialPayment: MerchantPayment | null;
  createdAt: Date;
};

export function createSale(input: {
  id: string;
  ownerUserId: string;
  customerId: string;
  items: SaleItemInput[];
  downPaymentMinor: number;
  condition: SaleCondition;
  installmentCount?: number | undefined;
  firstDueDate?: string | undefined;
  initialPaymentId?: string | undefined;
  initialPaymentMethod?: MerchantPaymentMethod | undefined;
  now: Date;
}): MerchantSale {
  if (!input.ownerUserId || !input.customerId) throw new MerchantLedgerRuleError('Owner and customer are required.');
  if (input.items.length < 1 || input.items.length > 100) throw new MerchantLedgerRuleError('A sale must contain between 1 and 100 items.');
  const items = input.items.map((item, index) => {
    const name = item.name.trim();
    if (name.length < 1 || name.length > 120) throw new MerchantLedgerRuleError('Sale item name is invalid.');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10_000) throw new MerchantLedgerRuleError('Sale item quantity is invalid.');
    if (!Number.isSafeInteger(item.unitPriceMinor) || item.unitPriceMinor < 0 || item.unitPriceMinor > 99_999_999) throw new MerchantLedgerRuleError('Sale item price is invalid.');
    const lineTotalMinor = item.quantity * item.unitPriceMinor;
    if (!Number.isSafeInteger(lineTotalMinor)) throw new MerchantLedgerRuleError('Sale item total is too large.');
    return { ...item, catalogItemId: item.catalogItemId ?? null, name, id: `${input.id}-item-${index + 1}`, lineTotalMinor };
  });
  const totalMinor = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new MerchantLedgerRuleError('Sale total must be positive.');
  if (!Number.isSafeInteger(input.downPaymentMinor) || input.downPaymentMinor < 0 || input.downPaymentMinor > totalMinor) throw new MerchantLedgerRuleError('Down payment is invalid.');

  const financedMinor = totalMinor - input.downPaymentMinor;
  let planned: Array<{ number: number; amountMinor: number; dueDate: string }> = [];
  if (input.condition === 'cash') {
    if (input.downPaymentMinor !== totalMinor) throw new MerchantLedgerRuleError('A cash sale must be paid in full.');
  } else if (financedMinor > 0) {
    if (!input.firstDueDate) throw new MerchantLedgerRuleError('A due date is required.');
    if (input.condition === 'single_due') {
      assertDate(input.firstDueDate);
      planned = [{ number: 1, amountMinor: financedMinor, dueDate: input.firstDueDate }];
    } else {
      planned = planSaleInstallments({ amountMinor: financedMinor, count: input.installmentCount ?? 0, firstDueDate: input.firstDueDate });
    }
  } else if (input.condition === 'installments' && (input.installmentCount ?? 0) < 2) {
    throw new MerchantLedgerRuleError('Installment count is invalid.');
  }

  const installments = planned.map((item) => ({
    ...item,
    id: `${input.id}-installment-${item.number}`,
    ownerUserId: input.ownerUserId,
    saleId: input.id,
    customerId: input.customerId,
    status: 'open' as const,
  }));
  const initialPayment = input.downPaymentMinor > 0 ? {
    id: input.initialPaymentId ?? `${input.id}-entry`,
    ownerUserId: input.ownerUserId,
    customerId: input.customerId,
    saleId: input.id,
    installmentId: null,
    amountMinor: input.downPaymentMinor,
    method: input.initialPaymentMethod ?? 'cash',
    reference: null,
    paidAt: input.now,
  } : null;

  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    customerId: input.customerId,
    condition: input.condition,
    totalMinor,
    downPaymentMinor: input.downPaymentMinor,
    financedMinor,
    items,
    installments,
    initialPayment,
    createdAt: input.now,
  };
}

export function planSaleInstallments(input: { amountMinor: number; count: number; firstDueDate: string }) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new MerchantLedgerRuleError('Financed amount must be positive.');
  if (!Number.isSafeInteger(input.count) || input.count < 2 || input.count > 120) throw new MerchantLedgerRuleError('Installment count must be between 2 and 120.');
  const baseDate = parseDate(input.firstDueDate);
  const baseAmount = Math.floor(input.amountMinor / input.count);
  const remainder = input.amountMinor % input.count;
  return Array.from({ length: input.count }, (_, index) => ({
    number: index + 1,
    amountMinor: baseAmount + (index < remainder ? 1 : 0),
    dueDate: addMonthsClamped(baseDate, index),
  }));
}

export function getInstallmentStatus(installment: Pick<SaleInstallment, 'dueDate' | 'status' | 'amountMinor'>, payments: MerchantPayment[], today: string): InstallmentStatus {
  if (installment.status === 'canceled') return 'canceled';
  const paid = payments.reduce((sum, payment) => sum + payment.amountMinor, 0);
  if (paid >= installment.amountMinor) return 'paid';
  if (paid > 0) return 'partially_paid';
  assertDate(today);
  if (installment.dueDate < today) return 'overdue';
  if (installment.dueDate === today) return 'due_today';
  return 'pending';
}

export function getSaleBalance(sale: Pick<MerchantSale, 'totalMinor'>, payments: MerchantPayment[]): number {
  return Math.max(0, sale.totalMinor - payments.reduce((sum, payment) => sum + payment.amountMinor, 0));
}

export function registerInstallmentPayment(input: {
  id: string;
  installment: SaleInstallment;
  existingPayments?: MerchantPayment[] | undefined;
  amountMinor: number;
  method: MerchantPaymentMethod;
  reference?: string | undefined;
  now: Date;
}): MerchantPayment {
  if (input.installment.status !== 'open') throw new MerchantLedgerRuleError('Canceled installments cannot be paid.');
  const paid = (input.existingPayments ?? []).reduce((sum, payment) => sum + payment.amountMinor, 0);
  const remaining = input.installment.amountMinor - paid;
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || input.amountMinor > remaining) throw new MerchantLedgerRuleError('Payment amount exceeds the remaining balance.');
  const reference = input.reference?.trim();
  return {
    id: input.id,
    ownerUserId: input.installment.ownerUserId,
    customerId: input.installment.customerId,
    saleId: input.installment.saleId,
    installmentId: input.installment.id,
    amountMinor: input.amountMinor,
    method: input.method,
    reference: reference ? reference.slice(0, 240) : null,
    paidAt: input.now,
  };
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MerchantLedgerRuleError('Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (parsed.toISOString().slice(0, 10) !== value) throw new MerchantLedgerRuleError('Date is invalid.');
  return parsed;
}

function assertDate(value: string): void { parseDate(value); }

function addMonthsClamped(firstDate: Date, offset: number): string {
  const year = firstDate.getUTCFullYear();
  const month = firstDate.getUTCMonth() + offset;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const finalDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(firstDate.getUTCDate(), finalDay);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}
