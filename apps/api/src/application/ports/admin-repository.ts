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

export type AdminPurchaseSummary = {
  purchaseId: string;
  draftId: string;
  templateId: string;
  purchaseStatus: string;
  accessStatus: 'active' | 'revoked' | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AdminAccountAction = {
  action: 'account_suspended' | 'account_reactivated';
  actorEmail: string;
  createdAt: Date;
};

export interface AdminRepository {
  listUsers(input: { query?: string; limit: number; offset: number; now: Date }): {
    total: number;
    users: AdminUserSummary[];
  };
  getUser(input: { userId: string; now: Date }): {
    user: AdminUserSummary;
    purchases: AdminPurchaseSummary[];
    recentActions: AdminAccountAction[];
  } | undefined;
  setUserStatus(input: {
    userId: string;
    actorEmail: string;
    status: AdminAccountStatus;
    now: Date;
    id: string;
  }): { changed: boolean; revokedSessions: number } | undefined;
}
