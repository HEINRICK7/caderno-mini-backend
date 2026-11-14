export type AdminAccountStatus = 'active' | 'suspended';

export type AdminUserSummary = {
  id: string;
  email: string;
  accountStatus: AdminAccountStatus;
  createdAt: Date;
  activeSessions: number;
  purchaseCount: number;
  activeLicenses: number;
  draftCount: number;
};

export type AdminCustomerProfile = {
  name: string | null;
  whatsapp: string | null;
  birthDate: string | null;
};

export type AdminPurchaseSummary = {
  purchaseId: string;
  draftId: string | null;
  templateId: string | null;
  templateName: string;
  purchaseStatus: string;
  accessStatus: 'active' | 'revoked' | null;
  saleSource: 'checkout' | 'manual';
  accessPlan: 'annual' | 'lifetime' | null;
  amountMinor: number | null;
  currency: string | null;
  paymentMethod: 'pix' | 'bank_transfer' | 'cash' | 'other' | null;
  paymentReference: string | null;
  recordedByAdminEmail: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminDraftSummary = {
  id: string;
  templateId: string;
  templateName: string;
  updatedAt: Date;
};

export type AdminPlatformSaleSummary = {
  saleId: string;
  accessStatus: 'active' | 'expired' | 'revoked';
  accessPlan: 'annual' | 'lifetime';
  amountMinor: number;
  currency: string;
  paymentMethod: AdminPaymentMethod;
  paymentReference: string | null;
  recordedByAdminEmail: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export type AdminPaymentMethod = 'pix' | 'bank_transfer' | 'cash' | 'other';

export type AdminAccountAction = {
  action: 'account_suspended' | 'account_reactivated' | 'manual_payment_recorded' | 'manual_platform_sale_recorded' | 'customer_created';
  actorEmail: string;
  purchaseId: string | null;
  createdAt: Date;
};

export interface AdminRepository {
  createCustomer(input: {
    email: string;
    actorEmail: string;
    id: string;
    auditId: string;
    now: Date;
  }): { id: string; email: string; createdAt: Date } | undefined;
  listUsers(input: { query?: string; limit: number; offset: number; now: Date }): {
    total: number;
    users: AdminUserSummary[];
  };
  getUser(input: { userId: string; now: Date }): {
    user: AdminUserSummary & AdminCustomerProfile;
    purchases: AdminPurchaseSummary[];
    platformSales: AdminPlatformSaleSummary[];
    drafts: AdminDraftSummary[];
    recentActions: AdminAccountAction[];
  } | undefined;
  setUserStatus(input: {
    userId: string;
    actorEmail: string;
    status: AdminAccountStatus;
    now: Date;
    id: string;
  }): { changed: boolean; revokedSessions: number } | undefined;
  recordManualPayment(input: {
    userId: string;
    draftId: string;
    actorEmail: string;
    plan: 'annual' | 'lifetime';
    amountMinor: number;
    paymentMethod: AdminPaymentMethod;
    paymentReference?: string;
    purchaseId: string;
    callbackHash: string;
    auditId: string;
    grantId: string;
    now: Date;
  }): { purchaseId: string; expiresAt: Date | null } | undefined;
  recordManualPlatformSale(input: {
    userId: string;
    actorEmail: string;
    plan: 'annual' | 'lifetime';
    amountMinor: number;
    paymentMethod: AdminPaymentMethod;
    paymentReference?: string;
    saleId: string;
    auditId: string;
    now: Date;
  }): { saleId: string; expiresAt: Date | null } | undefined;
}
