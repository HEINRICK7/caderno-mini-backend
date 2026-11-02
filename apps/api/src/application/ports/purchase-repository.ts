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
  expiresAt: Date | null;
  updatedAt: Date;
};

export type UserAccessView = {
  purchaseId: string;
  draftId: string;
  purchaseStatus: PurchaseStatus;
  accessStatus: 'active' | 'revoked' | 'none';
  grantedAt: Date;
  expiresAt: Date | null;
};

export type PurchaseWebhookUpdate = {
  purchaseId: string;
  status: PurchaseStatus;
  providerOrderId: string;
  customerEmail?: string;
  grantEmail?: string;
  accessExpiresAt?: Date | null;
  revokeAccess: boolean;
  now: Date;
};

export interface PurchaseRepository {
  createPendingPurchase(purchase: NewPendingPurchase): void;
  findForWebhook(callbackHash: string | null, providerOrderId: string): Purchase | undefined;
  applyWebhookUpdate(update: PurchaseWebhookUpdate): void;
  findStatusForUser(purchaseId: string, userId: string, now: Date): PurchaseStatusView | undefined;
  listAccessForUser(userId: string, now: Date): UserAccessView[];
  hasActiveGrantForUserAndDraft(userId: string, draftId: string, now: Date): boolean;
  hasActiveGrantForDraft(draftId: string, now: Date): boolean;
}
