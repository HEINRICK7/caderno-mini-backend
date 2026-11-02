import { describe, expect, it } from 'vitest';

import { accessExpiresAt, accessIsCurrent, transitionPurchase } from '../../../src/domain/commerce/purchase.js';

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

describe('access term', () => {
  const grantedAt = new Date('2026-11-02T15:04:00.000Z');

  it('ends an annual license twelve calendar months after payment', () => {
    expect(accessExpiresAt('annual', grantedAt)?.toISOString()).toBe('2027-11-02T15:04:00.000Z');
    expect(accessExpiresAt('annual', new Date('2024-02-29T00:00:00.000Z'))?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });

  it('leaves a lifetime license without an end date', () => {
    expect(accessExpiresAt('lifetime', grantedAt)).toBeNull();
  });

  it('treats a missing end date as current and an reached end date as finished', () => {
    expect(accessIsCurrent({ status: 'active', expiresAt: null }, grantedAt)).toBe(true);
    expect(accessIsCurrent({ status: 'active', expiresAt: new Date('2027-11-02T15:04:00.000Z') }, grantedAt)).toBe(true);
    expect(accessIsCurrent({ status: 'active', expiresAt: grantedAt }, grantedAt)).toBe(false);
    expect(accessIsCurrent({ status: 'revoked', expiresAt: null }, grantedAt)).toBe(false);
  });
});
