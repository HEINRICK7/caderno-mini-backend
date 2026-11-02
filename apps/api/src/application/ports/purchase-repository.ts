import type { Purchase, PurchaseStatus } from '../../domain/commerce/purchase.js';

export type NewPendingPurchase = {
  id: string;
  draftId: string;
  ownerUserId?: string;
  callbackHash: string;
  createdAt: Date;
};

export type PurchaseStatusView = {
  purchaseId: string;
  draftId: string;
  status: PurchaseStatus;
  accessStatus: 'active' | 'revoked' | 'none';
  updatedAt: Date;
};

export type UserAccessView = {
  purchaseId: string;
  draftId: string;
  purchaseStatus: PurchaseStatus;
  accessStatus: 'active' | 'revoked';
  grantedAt: Date;
};

export type PurchaseWebhookUpdate = {
  purchaseId: string;
  status: PurchaseStatus;
  providerOrderId: string;
  customerEmail?: string;
  grantEmail?: string;
  revokeAccess: boolean;
  now: Date;
};

export interface PurchaseRepository {
  createPendingPurchase(purchase: NewPendingPurchase): void;
  findForWebhook(callbackHash: string | null, providerOrderId: string): Purchase | undefined;
  applyWebhookUpdate(update: PurchaseWebhookUpdate): void;
  findStatusForUser(purchaseId: string, userId: string): PurchaseStatusView | undefined;
  listAccessForUser(userId: string): UserAccessView[];
  hasActiveGrantForUserAndDraft(userId: string, draftId: string): boolean;
  hasActiveGrantForDraft(draftId: string): boolean;
}
