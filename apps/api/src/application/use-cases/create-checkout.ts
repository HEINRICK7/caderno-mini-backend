import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { DraftNotFoundError } from '../errors.js';
import type { CheckoutLink } from '../ports/checkout-link.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { PurchaseRepository } from '../ports/purchase-repository.js';
import type { AccessPlan } from '../../domain/commerce/purchase.js';

export type CreateCheckoutDependencies = {
  drafts: DraftRepository;
  purchases: PurchaseRepository;
  checkoutLinks: CheckoutLink;
  generateId?: () => string;
  generateCallback?: () => string;
  clock?: () => Date;
};

export function createCheckout(
  input: { draftId?: string; userId?: string; plan?: AccessPlan },
  dependencies: CreateCheckoutDependencies,
): { purchaseId: string; checkoutUrl: string; status: 'pending' } | Promise<{ purchaseId: string; checkoutUrl: string; status: 'pending' }> {
  const draft = input.draftId
    ? dependencies.drafts.findByIdForUser(input.draftId, input.userId)
    : undefined;
  if (input.draftId && !draft) {
    throw new DraftNotFoundError();
  }

  const callbackToken = (dependencies.generateCallback ?? generateCallbackToken)();
  if (!/^[A-Za-z0-9._~-]{1,255}$/.test(callbackToken)) {
    throw new Error('Generated payment reference is invalid.');
  }

  const purchaseId = (dependencies.generateId ?? randomUUID)();
  const createdAt = (dependencies.clock ?? (() => new Date()))();
  const checkoutUrl = dependencies.checkoutLinks.createUrl(callbackToken, {
    purchaseId,
    ...(draft ? { draftId: draft.id } : {}),
  });
  const finish = (url: string) => {
    dependencies.purchases.createPendingPurchase({
      id: purchaseId,
      draftId: draft?.id ?? null,
      ...(input.plan ? { accessPlan: input.plan } : {}),
      ...(input.userId ? { ownerUserId: input.userId } : {}),
      callbackHash: hashToken(callbackToken),
      createdAt,
    });

    return { purchaseId, checkoutUrl: url, status: 'pending' as const };
  };

  return checkoutUrl instanceof Promise ? checkoutUrl.then(finish) : finish(checkoutUrl);
}

function generateCallbackToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
