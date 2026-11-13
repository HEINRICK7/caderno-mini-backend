import { and, count, desc, eq, ne, or, sql } from 'drizzle-orm';

import type { AdminRepository } from '../../../application/ports/admin-repository.js';
import { accessExpiresAt } from '../../../domain/commerce/purchase.js';
import type { AppDatabase } from '../connection.js';
import { accessGrants, adminAuditEvents, adminAuditLog, drafts, platformAccessGrants, purchases, sessions, templates, users } from '../schema.js';

export class SqliteAdminRepository implements AdminRepository {
  constructor(private readonly database: AppDatabase, private readonly adminEmail?: string) {}

  createCustomer(input: { email: string; actorEmail: string; id: string; auditId: string; now: Date }) {
    return this.database.transaction((transaction) => {
      const existingUser = transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, input.email))
        .get();
      if (existingUser || input.email === this.adminEmail) return undefined;

      const user = transaction.insert(users).values({
        id: input.id,
        email: input.email,
        accountStatus: 'active',
        emailVerifiedAt: input.now,
        createdAt: input.now,
      }).returning({ id: users.id, email: users.email, createdAt: users.createdAt }).get();
      if (!user) return undefined;

      transaction.insert(adminAuditEvents).values({
        id: input.auditId,
        actorEmail: input.actorEmail,
        targetUserId: user.id,
        action: 'customer_created',
        purchaseId: null,
        createdAt: input.now,
      }).run();

      return user;
    });
  }

  listUsers(input: { query?: string; limit: number; offset: number; now: Date }) {
    const queryFilter = input.query
      ? sql`instr(lower(${users.email}), lower(${input.query})) > 0`
      : undefined;
    const adminFilter = this.adminEmail ? ne(users.email, this.adminEmail) : undefined;
    const where = queryFilter && adminFilter
      ? and(queryFilter, adminFilter)
      : queryFilter ?? adminFilter;
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
      .select({
        ...summarySelection(input.now),
        name: users.name,
        whatsapp: users.whatsapp,
        birthDate: users.birthDate,
      })
      .from(users)
      .where(and(eq(users.id, input.userId), this.adminEmail ? ne(users.email, this.adminEmail) : undefined))
      .get();
    if (!user) return undefined;

    const userPurchases = this.database
      .select({
        purchaseId: purchases.id,
        draftId: purchases.draftId,
        templateId: drafts.templateId,
        templateName: templates.name,
        purchaseStatus: purchases.status,
        accessStatus: accessGrants.status,
        expiresAt: accessGrants.expiresAt,
        saleSource: purchases.saleSource,
        accessPlan: purchases.accessPlan,
        amountMinor: purchases.amountMinor,
        currency: purchases.currency,
        paymentMethod: purchases.paymentMethod,
        paymentReference: purchases.paymentReference,
        recordedByAdminEmail: purchases.recordedByAdminEmail,
        createdAt: purchases.createdAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .innerJoin(drafts, eq(drafts.id, purchases.draftId))
      .innerJoin(templates, and(eq(templates.id, drafts.templateId), eq(templates.version, drafts.templateVersion)))
      .leftJoin(accessGrants, eq(accessGrants.purchaseId, purchases.id))
      .where(or(eq(purchases.ownerUserId, input.userId), eq(accessGrants.userId, input.userId)))
      .orderBy(desc(purchases.createdAt))
      .all()
      .map(({ expiresAt, accessStatus, ...purchase }) => ({
        ...purchase,
        accessStatus: accessStatus === 'active' && expiresAt !== null && expiresAt <= input.now ? null : accessStatus,
        expiresAt: expiresAt ?? null,
      }));

    const platformSales = this.database
      .select({
        saleId: platformAccessGrants.id,
        accessStatus: platformAccessGrants.status,
        accessPlan: platformAccessGrants.accessPlan,
        amountMinor: platformAccessGrants.amountMinor,
        currency: platformAccessGrants.currency,
        paymentMethod: platformAccessGrants.paymentMethod,
        paymentReference: platformAccessGrants.paymentReference,
        recordedByAdminEmail: platformAccessGrants.recordedByAdminEmail,
        expiresAt: platformAccessGrants.expiresAt,
        createdAt: platformAccessGrants.grantedAt,
      })
      .from(platformAccessGrants)
      .where(eq(platformAccessGrants.userId, input.userId))
      .orderBy(desc(platformAccessGrants.grantedAt))
      .all()
      .map((sale) => ({
        ...sale,
        accessStatus: sale.accessStatus === 'active' && sale.expiresAt !== null && sale.expiresAt <= input.now
          ? 'expired' as const
          : sale.accessStatus,
        expiresAt: sale.expiresAt ?? null,
        paymentReference: sale.paymentReference ?? null,
      }));

    const userDrafts = this.database
      .select({
        id: drafts.id,
        templateId: drafts.templateId,
        templateName: templates.name,
        updatedAt: drafts.updatedAt,
      })
      .from(drafts)
      .innerJoin(templates, and(eq(templates.id, drafts.templateId), eq(templates.version, drafts.templateVersion)))
      .where(eq(drafts.ownerUserId, input.userId))
      .orderBy(desc(drafts.updatedAt))
      .all();

    const legacyActions = this.database
      .select({ action: adminAuditLog.action, actorEmail: users.email, createdAt: adminAuditLog.createdAt })
      .from(adminAuditLog)
      .innerJoin(users, eq(users.id, adminAuditLog.actorUserId))
      .where(eq(adminAuditLog.targetUserId, input.userId))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(20)
      .all();
    const recentActions = [
      ...legacyActions.map((action) => ({ ...action, purchaseId: null })),
      ...this.database
        .select({ action: adminAuditEvents.action, actorEmail: adminAuditEvents.actorEmail, purchaseId: adminAuditEvents.purchaseId, createdAt: adminAuditEvents.createdAt })
        .from(adminAuditEvents)
        .where(eq(adminAuditEvents.targetUserId, input.userId))
        .orderBy(desc(adminAuditEvents.createdAt))
        .limit(20)
        .all(),
    ]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 20);

    return { user, purchases: userPurchases, platformSales, drafts: userDrafts, recentActions };
  }

  setUserStatus(input: {
    userId: string;
    actorEmail: string;
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

      transaction.insert(adminAuditEvents).values({
        id: input.id,
        actorEmail: input.actorEmail,
        targetUserId: input.userId,
        action: input.status === 'suspended' ? 'account_suspended' : 'account_reactivated',
        createdAt: input.now,
      }).run();

      return { changed: true, revokedSessions };
    });
  }

  recordManualPayment(input: {
    userId: string;
    draftId: string;
    actorEmail: string;
    plan: 'annual' | 'lifetime';
    amountMinor: number;
    paymentMethod: 'pix' | 'bank_transfer' | 'cash' | 'other';
    paymentReference?: string;
    purchaseId: string;
    callbackHash: string;
    auditId: string;
    grantId: string;
    now: Date;
  }) {
    return this.database.transaction((transaction) => {
      const customer = transaction
        .select({ id: users.id, email: users.email, accountStatus: users.accountStatus })
        .from(users)
        .where(eq(users.id, input.userId))
        .get();
      const customerDraft = transaction
        .select({ id: drafts.id })
        .from(drafts)
        .where(and(eq(drafts.id, input.draftId), eq(drafts.ownerUserId, input.userId)))
        .get();
      if (!customer || customer.accountStatus !== 'active' || !customerDraft) return undefined;

      const activeTerms = transaction
        .select({ expiresAt: accessGrants.expiresAt })
        .from(accessGrants)
        .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
        .where(and(
          eq(accessGrants.userId, input.userId),
          eq(accessGrants.status, 'active'),
          eq(purchases.draftId, input.draftId),
          eq(purchases.status, 'paid'),
        ))
        .all();
      const annualStartsAt = activeTerms.reduce((latest, term) =>
        term.expiresAt && term.expiresAt > latest ? term.expiresAt : latest,
      input.now);
      const expiresAt = input.plan === 'annual' ? accessExpiresAt('annual', annualStartsAt) : null;

      transaction.insert(purchases).values({
        id: input.purchaseId,
        draftId: input.draftId,
        ownerUserId: customer.id,
        callbackHash: input.callbackHash,
        providerOrderId: null,
        customerEmail: customer.email,
        status: 'paid',
        amountMinor: input.amountMinor,
        currency: 'BRL',
        saleSource: 'manual',
        accessPlan: input.plan,
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        recordedByAdminEmail: input.actorEmail,
        createdAt: input.now,
        updatedAt: input.now,
      }).run();

      transaction.insert(accessGrants).values({
        id: input.grantId,
        purchaseId: input.purchaseId,
        userId: customer.id,
        customerEmail: customer.email,
        status: 'active',
        grantedAt: input.now,
        expiresAt,
        revokedAt: null,
        updatedAt: input.now,
      }).run();

      transaction.insert(adminAuditEvents).values({
        id: input.auditId,
        actorEmail: input.actorEmail,
        targetUserId: customer.id,
        action: 'manual_payment_recorded',
        purchaseId: input.purchaseId,
        createdAt: input.now,
      }).run();

      return { purchaseId: input.purchaseId, expiresAt };
    });
  }

  recordManualPlatformSale(input: {
    userId: string;
    actorEmail: string;
    plan: 'annual' | 'lifetime';
    amountMinor: number;
    paymentMethod: 'pix' | 'bank_transfer' | 'cash' | 'other';
    paymentReference?: string;
    saleId: string;
    auditId: string;
    now: Date;
  }) {
    return this.database.transaction((transaction) => {
      const customer = transaction
        .select({ id: users.id, accountStatus: users.accountStatus })
        .from(users)
        .where(eq(users.id, input.userId))
        .get();
      if (!customer || customer.accountStatus !== 'active') return undefined;

      const platformTerms = transaction
        .select({ expiresAt: platformAccessGrants.expiresAt, status: platformAccessGrants.status })
        .from(platformAccessGrants)
        .where(eq(platformAccessGrants.userId, input.userId))
        .all();
      const draftTerms = transaction
        .select({ expiresAt: accessGrants.expiresAt, status: accessGrants.status })
        .from(accessGrants)
        .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
        .where(and(
          eq(accessGrants.userId, input.userId),
          eq(purchases.status, 'paid'),
        ))
        .all();
      const activeTerms = [...platformTerms, ...draftTerms].filter((term) =>
        term.status === 'active' && (term.expiresAt === null || term.expiresAt > input.now),
      );
      const annualStartsAt = activeTerms.reduce((latest, term) =>
        term.expiresAt && term.expiresAt > latest ? term.expiresAt : latest,
      input.now);
      const expiresAt = input.plan === 'annual' ? accessExpiresAt('annual', annualStartsAt) : null;

      transaction.insert(platformAccessGrants).values({
        id: input.saleId,
        userId: customer.id,
        status: 'active',
        accessPlan: input.plan,
        amountMinor: input.amountMinor,
        currency: 'BRL',
        paymentMethod: input.paymentMethod,
        paymentReference: input.paymentReference ?? null,
        recordedByAdminEmail: input.actorEmail,
        grantedAt: input.now,
        expiresAt,
        revokedAt: null,
        updatedAt: input.now,
      }).run();

      transaction.insert(adminAuditEvents).values({
        id: input.auditId,
        actorEmail: input.actorEmail,
        targetUserId: customer.id,
        action: 'manual_platform_sale_recorded',
        purchaseId: null,
        createdAt: input.now,
      }).run();

      return { saleId: input.saleId, expiresAt };
    });
  }
}

function summarySelection(now: Date) {
  const outerUserId = sql.raw('"users"."id"');

  return {
    id: users.id,
    email: users.email,
    accountStatus: users.accountStatus,
    createdAt: users.createdAt,
    activeSessions: sql<number>`(
      SELECT COUNT(*) FROM sessions
      WHERE sessions.user_id = ${outerUserId}
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ${now.getTime()}
    )`,
    purchaseCount: sql<number>`(
      SELECT COUNT(DISTINCT purchases.id)
      FROM purchases
      LEFT JOIN access_grants ON access_grants.purchase_id = purchases.id
      WHERE purchases.owner_user_id = ${outerUserId} OR access_grants.user_id = ${outerUserId}
    ) + (
      SELECT COUNT(*) FROM platform_access_grants
      WHERE platform_access_grants.user_id = ${outerUserId}
    )`,
    activeLicenses: sql<number>`(
      SELECT COUNT(*)
      FROM access_grants
      INNER JOIN purchases ON purchases.id = access_grants.purchase_id
      WHERE access_grants.user_id = ${outerUserId}
        AND access_grants.status = 'active'
        AND purchases.status = 'paid'
        AND (access_grants.expires_at IS NULL OR access_grants.expires_at > ${now.getTime()})
    ) + CASE WHEN EXISTS (
      SELECT 1 FROM platform_access_grants
      WHERE platform_access_grants.user_id = ${outerUserId}
        AND platform_access_grants.status = 'active'
        AND (platform_access_grants.expires_at IS NULL OR platform_access_grants.expires_at > ${now.getTime()})
    ) THEN 1 ELSE 0 END`,
    draftCount: sql<number>`(
      SELECT COUNT(*) FROM drafts WHERE drafts.owner_user_id = ${outerUserId}
    )`,
  };
}
