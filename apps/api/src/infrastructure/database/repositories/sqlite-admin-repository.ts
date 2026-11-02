import { and, count, desc, eq, ne, or, sql } from 'drizzle-orm';

import type { AdminRepository } from '../../../application/ports/admin-repository.js';
import type { AppDatabase } from '../connection.js';
import { accessGrants, adminAuditLog, drafts, purchases, sessions, users } from '../schema.js';

export class SqliteAdminRepository implements AdminRepository {
  constructor(private readonly database: AppDatabase) {}

  listUsers(input: { query?: string; limit: number; offset: number; now: Date }) {
    const where = input.query
      ? sql`instr(lower(${users.email}), lower(${input.query})) > 0`
      : undefined;
    const total = this.database
      .select({ value: count() })
      .from(users)
      .where(where)
      .get()?.value ?? 0;

    const records = this.database
      .select(summarySelection(input.now))
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .all();

    return { total, users: records };
  }

  getUser(input: { userId: string; now: Date }) {
    const user = this.database
      .select(summarySelection(input.now))
      .from(users)
      .where(eq(users.id, input.userId))
      .get();
    if (!user) return undefined;

    const userPurchases = this.database
      .select({
        purchaseId: purchases.id,
        draftId: purchases.draftId,
        templateId: drafts.templateId,
        purchaseStatus: purchases.status,
        accessStatus: accessGrants.status,
        createdAt: purchases.createdAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .innerJoin(drafts, eq(drafts.id, purchases.draftId))
      .leftJoin(accessGrants, eq(accessGrants.purchaseId, purchases.id))
      .where(or(eq(purchases.ownerUserId, input.userId), eq(accessGrants.userId, input.userId)))
      .orderBy(desc(purchases.createdAt))
      .all();

    const recentActions = this.database
      .select({ action: adminAuditLog.action, actorEmail: users.email, createdAt: adminAuditLog.createdAt })
      .from(adminAuditLog)
      .innerJoin(users, eq(users.id, adminAuditLog.actorUserId))
      .where(eq(adminAuditLog.targetUserId, input.userId))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(20)
      .all();

    return { user, purchases: userPurchases, recentActions };
  }

  setUserStatus(input: {
    userId: string;
    actorUserId: string;
    status: 'active' | 'suspended';
    now: Date;
    id: string;
  }) {
    return this.database.transaction((transaction) => {
      const target = transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .get();
      if (!target) return undefined;

      const changed = transaction
        .update(users)
        .set({ accountStatus: input.status })
        .where(and(eq(users.id, input.userId), ne(users.accountStatus, input.status)))
        .run();
      if (changed.changes === 0) return { changed: false, revokedSessions: 0 };

      const revokedSessions = input.status === 'suspended'
        ? transaction
          .update(sessions)
          .set({ revokedAt: input.now })
          .where(and(eq(sessions.userId, input.userId), sql`${sessions.revokedAt} IS NULL`))
          .run().changes
        : 0;

      transaction.insert(adminAuditLog).values({
        id: input.id,
        actorUserId: input.actorUserId,
        targetUserId: input.userId,
        action: input.status === 'suspended' ? 'account_suspended' : 'account_reactivated',
        createdAt: input.now,
      }).run();

      return { changed: true, revokedSessions };
    });
  }
}

function summarySelection(now: Date) {
  return {
    id: users.id,
    email: users.email,
    accountStatus: users.accountStatus,
    createdAt: users.createdAt,
    activeSessions: sql<number>`(
      SELECT COUNT(*) FROM sessions
      WHERE sessions.user_id = ${users.id}
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ${now.getTime()}
    )`,
    purchaseCount: sql<number>`(
      SELECT COUNT(DISTINCT purchases.id)
      FROM purchases
      LEFT JOIN access_grants ON access_grants.purchase_id = purchases.id
      WHERE purchases.owner_user_id = ${users.id} OR access_grants.user_id = ${users.id}
    )`,
    activeLicenses: sql<number>`(
      SELECT COUNT(*)
      FROM access_grants
      INNER JOIN purchases ON purchases.id = access_grants.purchase_id
      WHERE access_grants.user_id = ${users.id}
        AND access_grants.status = 'active'
        AND purchases.status = 'paid'
    )`,
    draftCount: sql<number>`(
      SELECT COUNT(*) FROM drafts WHERE drafts.owner_user_id = ${users.id}
    )`,
  };
}
