export type PurchaseStatus = 'pending' | 'paid' | 'refunded' | 'chargedback' | 'canceled' | 'refused';

export type Purchase = {
  id: string;
  draftId: string;
  callbackHash: string;
  providerOrderId?: string;
  customerEmail?: string;
  status: PurchaseStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentSignal =
  | 'pending'
  | 'approved'
  | 'refused'
  | 'refunded'
  | 'chargeback'
  | 'refund_requested'
  | 'other';

export type PurchaseTransition = {
  status: PurchaseStatus;
  grantAccess: boolean;
  revokeAccess: boolean;
};

export type AccessPlan = 'annual' | 'lifetime';

const ANNUAL_ACCESS_MONTHS = 12;

export function accessExpiresAt(plan: AccessPlan, grantedAt: Date): Date | null {
  if (plan === 'lifetime') return null;
  return addUtcMonths(grantedAt, ANNUAL_ACCESS_MONTHS);
}

export function accessIsCurrent(
  access: { status: 'active' | 'revoked' | 'none'; expiresAt: Date | null },
  now: Date,
): boolean {
  return access.status === 'active' && (access.expiresAt === null || access.expiresAt > now);
}

function addUtcMonths(value: Date, months: number): Date {
  const result = new Date(value.getTime());
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() !== day) result.setUTCDate(0);
  return result;
}

export function transitionPurchase(
  currentStatus: PurchaseStatus,
  signal: PaymentSignal,
): PurchaseTransition {
  if (signal === 'approved') {
    if (currentStatus === 'refunded' || currentStatus === 'chargedback' || currentStatus === 'canceled') {
      return { status: currentStatus, grantAccess: false, revokeAccess: false };
    }
    return {
      status: 'paid',
      grantAccess: currentStatus !== 'paid',
      revokeAccess: false,
    };
  }

  if (signal === 'refused' && currentStatus === 'pending') {
    return { status: 'refused', grantAccess: false, revokeAccess: false };
  }

  if (signal === 'refunded' && currentStatus !== 'chargedback') {
    return {
      status: 'refunded',
      grantAccess: false,
      revokeAccess: currentStatus === 'paid',
    };
  }

  if (signal === 'chargeback' && currentStatus !== 'refunded') {
    return {
      status: 'chargedback',
      grantAccess: false,
      revokeAccess: currentStatus === 'paid',
    };
  }

  return { status: currentStatus, grantAccess: false, revokeAccess: false };
}
