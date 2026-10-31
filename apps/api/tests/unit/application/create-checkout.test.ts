import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { DraftNotFoundError } from '../../../src/application/errors.js';
import { createCheckout } from '../../../src/application/use-cases/create-checkout.js';

const now = new Date('2026-10-31T22:00:00.000Z');
const draft = {
  id: 'draft-id',
  templateId: 'mensagem-exemplo',
  templateVersion: 1,
  data: { message: 'Olá' },
  createdAt: now,
  updatedAt: now,
};

describe('createCheckout', () => {
  it('creates a pending server-owned purchase and adds an opaque callback to the hosted checkout URL', () => {
    const createPendingPurchase = vi.fn();

    const checkout = createCheckout(
      { draftId: draft.id },
      {
        drafts: {
          findById: vi.fn(),
          findByIdForUser: vi.fn().mockReturnValue(draft),
          insert: vi.fn(),
          update: vi.fn(),
          updateForUser: vi.fn(),
        },
        purchases: { createPendingPurchase },
        checkoutLinks: { createUrl: vi.fn((callback) => `https://pay.cakto.com.br/offer?callback=${callback}`) },
        generateId: () => 'purchase-id',
        generateCallback: () => 'aAbBcCdD_123-~',
        clock: () => now,
      },
    );

    expect(checkout).toEqual({
      purchaseId: 'purchase-id',
      checkoutUrl: 'https://pay.cakto.com.br/offer?callback=aAbBcCdD_123-~',
      status: 'pending',
    });
    expect(createPendingPurchase).toHaveBeenCalledWith({
      id: 'purchase-id',
      draftId: 'draft-id',
      callbackHash: createHash('sha256').update('aAbBcCdD_123-~').digest('hex'),
      createdAt: now,
    });
  });

  it('does not create checkout for a missing draft', () => {
    const createPendingPurchase = vi.fn();
    expect(() =>
      createCheckout(
        { draftId: 'missing' },
        {
          drafts: {
            findById: vi.fn(),
            findByIdForUser: vi.fn().mockReturnValue(undefined),
            insert: vi.fn(),
            update: vi.fn(),
            updateForUser: vi.fn(),
          },
          purchases: { createPendingPurchase },
          checkoutLinks: { createUrl: vi.fn() },
          generateId: () => 'purchase-id',
          generateCallback: () => 'callback-token',
          clock: () => now,
        },
      ),
    ).toThrow(DraftNotFoundError);
    expect(createPendingPurchase).not.toHaveBeenCalled();
  });
});
