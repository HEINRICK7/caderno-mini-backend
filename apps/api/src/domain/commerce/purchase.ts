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
