import type { PurchaseRepository } from '../ports/purchase-repository.js';
import { PurchaseNotFoundError } from '../errors.js';

export function getPurchaseStatus(
  input: { purchaseId: string; userId: string },
  dependencies: { purchases: PurchaseRepository },
) {
  const status = dependencies.purchases.findStatusForUser(input.purchaseId, input.userId);
  if (!status) {
    throw new PurchaseNotFoundError();
  }
  return status;
}

export function listUserAccess(
  input: { userId: string },
  dependencies: { purchases: PurchaseRepository },
) {
  return dependencies.purchases.listAccessForUser(input.userId);
}

export function userHasActiveGrantForDraft(
  input: { userId: string; draftId: string },
  dependencies: { purchases: PurchaseRepository },
): boolean {
  return dependencies.purchases.hasActiveGrantForUserAndDraft(input.userId, input.draftId);
}
