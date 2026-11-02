import type { PurchaseRepository } from '../ports/purchase-repository.js';
import { PurchaseNotFoundError } from '../errors.js';

export function getPurchaseStatus(
  input: { purchaseId: string; userId: string },
  dependencies: { purchases: PurchaseRepository; clock?: () => Date },
) {
  const status = dependencies.purchases.findStatusForUser(input.purchaseId, input.userId, dependencies.clock?.() ?? new Date());
  if (!status) {
    throw new PurchaseNotFoundError();
  }
  return status;
}

export function listUserAccess(
  input: { userId: string },
  dependencies: { purchases: PurchaseRepository; clock?: () => Date },
) {
  return dependencies.purchases.listAccessForUser(input.userId, dependencies.clock?.() ?? new Date());
}

export function userHasActiveGrantForDraft(
  input: { userId: string; draftId: string },
  dependencies: { purchases: PurchaseRepository; clock?: () => Date },
): boolean {
  return dependencies.purchases.hasActiveGrantForUserAndDraft(input.userId, input.draftId, dependencies.clock?.() ?? new Date());
}
