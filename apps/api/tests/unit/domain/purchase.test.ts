import { describe, expect, it } from 'vitest';

import { transitionPurchase } from '../../../src/domain/commerce/purchase.js';

describe('transitionPurchase', () => {
  it('grants access only on the first approved payment', () => {
    expect(transitionPurchase('pending', 'approved')).toEqual({
      status: 'paid',
      grantAccess: true,
      revokeAccess: false,
    });
    expect(transitionPurchase('paid', 'approved')).toEqual({
      status: 'paid',
      grantAccess: false,
      revokeAccess: false,
    });
  });

  it('keeps generated payment requests pending and does not grant access', () => {
    expect(transitionPurchase('pending', 'pending')).toEqual({
      status: 'pending',
      grantAccess: false,
      revokeAccess: false,
    });
  });

  it('does not revoke for a refund request, only for a completed refund', () => {
    expect(transitionPurchase('paid', 'refund_requested')).toEqual({
      status: 'paid',
      grantAccess: false,
      revokeAccess: false,
    });
    expect(transitionPurchase('paid', 'refunded')).toEqual({
      status: 'refunded',
      grantAccess: false,
      revokeAccess: true,
    });
  });

  it('revokes after chargeback and never reactivates a terminal purchase', () => {
    expect(transitionPurchase('paid', 'chargeback')).toEqual({
      status: 'chargedback',
      grantAccess: false,
      revokeAccess: true,
    });
    expect(transitionPurchase('refunded', 'approved')).toEqual({
      status: 'refunded',
      grantAccess: false,
      revokeAccess: false,
    });
  });

  it('allows a later approved payment to correct a previous refusal', () => {
    expect(transitionPurchase('refused', 'approved')).toEqual({
      status: 'paid',
      grantAccess: true,
      revokeAccess: false,
    });
  });
});
