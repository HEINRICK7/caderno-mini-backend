import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';

import type {
  PurchaseRepository,
  NewPendingPurchase,
  PurchaseWebhookUpdate,
} from '../../../application/ports/purchase-repository.js';
import { accessExpiresAt, accessIsCurrent, type Purchase, type PurchaseStatus } from '../../../domain/commerce/purchase.js';
import type { AppDatabase } from '../connection.js';
import { accessGrants, drafts, platformAccessGrants, purchases, users, webhookEventEffects } from '../schema.js';

export class SqlitePurchaseRepository implements PurchaseRepository {
  constructor(private readonly database: AppDatabase, private readonly adminEmail?: string) {}

  createPendingPurchase(purchase: NewPendingPurchase): void {
    this.database
      .insert(purchases)
      .values({
        id: purchase.id,
        draftId: purchase.draftId,
        accessPlan: purchase.accessPlan ?? null,
        ownerUserId: purchase.ownerUserId ?? null,
        callbackHash: purchase.callbackHash,
        status: 'pending',
        customerEmail: null,
        providerOrderId: null,
        createdAt: purchase.createdAt,
        updatedAt: purchase.createdAt,
      })
      .run();
  }

  findForWebhook(callbackHash: string | null, providerOrderId: string): Purchase | undefined {
    const byCallback = callbackHash
      ? this.database.select().from(purchases).where(eq(purchases.callbackHash, callbackHash)).get()
      : undefined;
    const byProviderOrder = this.database
      .select()
      .from(purchases)
      .where(eq(purchases.providerOrderId, providerOrderId))
      .get();

    if (byCallback && byProviderOrder && byCallback.id !== byProviderOrder.id) {
      return undefined;
    }

    // A supplied externalId is the server-generated order capability. Never
    // fall back to an unrelated order ID when that capability fails to match.
    const purchase = callbackHash ? byCallback : byProviderOrder;
    if (!purchase) {
      return undefined;
    }

    return {
      id: purchase.id,
      draftId: purchase.draftId,
      callbackHash: purchase.callbackHash,
      ...(purchase.providerOrderId ? { providerOrderId: purchase.providerOrderId } : {}),
      ...(purchase.customerEmail ? { customerEmail: purchase.customerEmail } : {}),
      status: purchase.status,
      createdAt: purchase.createdAt,
      updatedAt: purchase.updatedAt,
    };
  }

  applyWebhookUpdate(update: PurchaseWebhookUpdate): void {
    this.database.transaction((transaction) => {
      const current = transaction.select().from(purchases).where(eq(purchases.id, update.purchaseId)).get();
      if (!current || (current.providerOrderId && current.providerOrderId !== update.providerOrderId)) {
        return;
      }

      if (update.sideEffectDedupeKey) {
        const effect = transaction
          .insert(webhookEventEffects)
          .values({ effectKey: update.sideEffectDedupeKey, createdAt: update.now })
          .onConflictDoNothing()
          .returning({ effectKey: webhookEventEffects.effectKey })
          .get();
        if (!effect) return;
      }

      let status: PurchaseStatus = update.status;
      const isTerminal = current.status === 'refunded' || current.status === 'chargedback' || current.status === 'canceled';
      if (isTerminal && status === 'paid') {
        status = current.status;
      } else if (current.status === 'paid' && status === 'refused') {
        status = 'paid';
      } else if (current.status === 'refunded' && status === 'chargedback') {
        status = 'refunded';
      }

      const existingUser = update.grantEmail
        ? transaction.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, update.grantEmail)).get()
        : current.ownerUserId
          ? transaction.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, current.ownerUserId)).get()
          : undefined;
      const grantEmail = update.grantEmail ?? current.customerEmail ?? existingUser?.email;

      transaction
        .update(purchases)
        .set({
          status,
          ownerUserId: current.ownerUserId ?? existingUser?.id ?? null,
          providerOrderId: current.providerOrderId ?? update.providerOrderId,
          customerEmail: update.customerEmail ?? current.customerEmail,
          amountMinor: current.amountMinor ?? update.amountMinor ?? null,
          currency: current.currency ?? update.currency ?? null,
          updatedAt: update.now,
        })
        .where(eq(purchases.id, update.purchaseId))
        .run();

      if (update.grantAccess && grantEmail && status === 'paid' && !isTerminal) {
        const currentGrant = transaction
          .select({ expiresAt: accessGrants.expiresAt })
          .from(accessGrants)
          .where(eq(accessGrants.purchaseId, update.purchaseId))
          .get();
        const now = update.accessEffectiveAt ?? update.now;
        const existingExpiry = currentGrant?.expiresAt ?? null;
        const accessExpiry = update.extendAnnualAccess
          ? accessExpiresAt('annual', existingExpiry && existingExpiry > now ? existingExpiry : now)
          : update.accessExpiresAt ?? existingExpiry;
        transaction
          .insert(accessGrants)
          .values({
            id: randomUUID(),
            purchaseId: update.purchaseId,
            userId: existingUser?.id ?? null,
            customerEmail: grantEmail,
            status: 'active',
            grantedAt: update.accessEffectiveAt ?? update.now,
            expiresAt: accessExpiry,
            revokedAt: null,
            updatedAt: update.now,
          })
          .onConflictDoUpdate({
            target: accessGrants.purchaseId,
            set: {
              userId: existingUser?.id ?? null,
              customerEmail: grantEmail,
              status: 'active',
              expiresAt: accessExpiry,
              grantedAt: update.accessEffectiveAt ?? update.now,
              revokedAt: null,
              updatedAt: update.now,
            },
          })
          .run();

        if (existingUser && current.draftId) {
          transaction
            .update(drafts)
            .set({ ownerUserId: existingUser.id })
            .where(and(eq(drafts.id, current.draftId), isNull(drafts.ownerUserId)))
            .run();
        }
      }

      if (update.revokeAccess) {
        transaction
          .update(accessGrants)
          .set({ status: 'revoked', revokedAt: update.now, updatedAt: update.now })
          .where(and(eq(accessGrants.purchaseId, update.purchaseId), eq(accessGrants.status, 'active')))
          .run();
      }
    });
  }

  findStatusForUser(purchaseId: string, userId: string, now: Date) {
    const row = this.database
      .select({
        purchaseId: purchases.id,
        draftId: purchases.draftId,
        status: purchases.status,
        accessStatus: accessGrants.status,
        amountMinor: purchases.amountMinor,
        currency: purchases.currency,
        expiresAt: accessGrants.expiresAt,
        updatedAt: purchases.updatedAt,
      })
      .from(purchases)
      .leftJoin(accessGrants, eq(accessGrants.purchaseId, purchases.id))
      .where(
        and(
          eq(purchases.id, purchaseId),
          or(eq(purchases.ownerUserId, userId), eq(accessGrants.userId, userId)),
        ),
      )
      .get();
    if (!row) {
      return undefined;
    }
    const storedStatus = row.accessStatus ?? 'none';
    const expiresAt = row.expiresAt ?? null;
    return {
      purchaseId: row.purchaseId,
      draftId: row.draftId,
      status: row.status,
      accessStatus: accessIsCurrent({ status: storedStatus, expiresAt }, now) ? 'active' : storedStatus === 'active' ? 'none' : storedStatus,
      amountMinor: row.amountMinor ?? null,
      currency: row.currency ?? null,
      expiresAt,
      updatedAt: row.updatedAt,
    } as const;
  }

  listAccessForUser(userId: string, now: Date) {
    return this.database
      .select({
        purchaseId: accessGrants.purchaseId,
        draftId: purchases.draftId,
        purchaseStatus: purchases.status,
        accessStatus: accessGrants.status,
        grantedAt: accessGrants.grantedAt,
        expiresAt: accessGrants.expiresAt,
      })
      .from(accessGrants)
      .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
      .where(and(eq(accessGrants.userId, userId), isNotNull(purchases.draftId)))
      .orderBy(purchases.createdAt)
      .all()
      .filter((row): row is typeof row & { draftId: string } => row.draftId !== null)
      .map((row) => ({
        ...row,
        expiresAt: row.expiresAt ?? null,
        accessStatus: accessIsCurrent({ status: row.accessStatus, expiresAt: row.expiresAt ?? null }, now)
          ? 'active' as const
          : row.accessStatus === 'active' ? 'none' as const : row.accessStatus,
      }));
  }

  getPlatformAccessForUser(userId: string, now: Date) {
    const manualGrants = this.database
      .select({ accessPlan: platformAccessGrants.accessPlan, expiresAt: platformAccessGrants.expiresAt })
      .from(platformAccessGrants)
      .innerJoin(users, eq(users.id, platformAccessGrants.userId))
      .where(and(
        eq(platformAccessGrants.userId, userId),
        eq(platformAccessGrants.status, 'active'),
        eq(users.accountStatus, 'active'),
        or(isNull(platformAccessGrants.expiresAt), gt(platformAccessGrants.expiresAt, now)),
      ))
      .all();
    const purchaseGrants = this.database
      .select({ accessPlan: purchases.accessPlan, expiresAt: accessGrants.expiresAt })
      .from(accessGrants)
      .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
      .innerJoin(users, eq(users.id, accessGrants.userId))
      .where(and(
        eq(accessGrants.userId, userId),
        eq(accessGrants.status, 'active'),
        eq(purchases.status, 'paid'),
        eq(users.accountStatus, 'active'),
        or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
      ))
      .all();
    const grants = [...manualGrants, ...purchaseGrants];
    const lifetimeGrant = grants.some((grant) => grant.accessPlan === 'lifetime');
    const expiresAt = grants.reduce<Date | null>((latest, grant) =>
      grant.expiresAt && (!latest || grant.expiresAt > latest) ? grant.expiresAt : latest,
    null);

    return {
      active: grants.length > 0,
      accessPlan: grants.length === 0 ? null : lifetimeGrant ? 'lifetime' as const : 'annual' as const,
      expiresAt: lifetimeGrant ? null : expiresAt,
    };
  }

  hasActiveGrantForUserAndDraft(userId: string, draftId: string, now: Date): boolean {
    if (this.adminEmail) {
      const adminOwnedDraft = this.database
        .select({ id: drafts.id })
        .from(drafts)
        .innerJoin(users, eq(users.id, drafts.ownerUserId))
        .where(
          and(
            eq(drafts.id, draftId),
            eq(drafts.ownerUserId, userId),
            eq(users.email, this.adminEmail),
            eq(users.accountStatus, 'active'),
          ),
        )
        .get();
      if (adminOwnedDraft) return true;
    }

    const ownedDraft = this.database
      .select({ id: drafts.id })
      .from(drafts)
      .innerJoin(users, eq(users.id, drafts.ownerUserId))
      .where(and(
        eq(drafts.id, draftId),
        eq(drafts.ownerUserId, userId),
        eq(users.accountStatus, 'active'),
      ))
      .get();
    if (!ownedDraft) return false;

    const platformGrant = this.database
      .select({ id: platformAccessGrants.id })
      .from(platformAccessGrants)
      .where(and(
        eq(platformAccessGrants.userId, userId),
        eq(platformAccessGrants.status, 'active'),
        or(isNull(platformAccessGrants.expiresAt), gt(platformAccessGrants.expiresAt, now)),
      ))
      .get();
    if (platformGrant) return true;

    return Boolean(
      this.database
        .select({ id: accessGrants.id })
        .from(accessGrants)
        .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
        .where(
          and(
            eq(accessGrants.userId, userId),
            eq(accessGrants.status, 'active'),
            eq(purchases.status, 'paid'),
            eq(purchases.draftId, draftId),
            or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
          ),
        )
        .get(),
    );
  }

  hasActiveGrantForDraft(draftId: string, now: Date): boolean {
    if (this.adminEmail) {
      const adminOwnedDraft = this.database
        .select({ id: drafts.id })
        .from(drafts)
        .innerJoin(users, eq(users.id, drafts.ownerUserId))
        .where(
          and(
            eq(drafts.id, draftId),
            eq(users.email, this.adminEmail),
            eq(users.accountStatus, 'active'),
          ),
        )
        .get();
      if (adminOwnedDraft) return true;
    }

    const draft = this.database
      .select({ ownerUserId: drafts.ownerUserId })
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .get();
    if (draft?.ownerUserId) {
      return this.hasActiveGrantForUserAndDraft(draft.ownerUserId, draftId, now);
    }

    return Boolean(
      this.database
        .select({ id: accessGrants.id })
        .from(accessGrants)
        .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
        .where(and(
          eq(purchases.draftId, draftId),
          eq(accessGrants.status, 'active'),
          eq(purchases.status, 'paid'),
          or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
        ))
        .get(),
    );
  }
}
