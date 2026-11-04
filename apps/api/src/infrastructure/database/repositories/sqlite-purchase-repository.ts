import { randomUUID } from 'node:crypto';

import { and, eq, gt, isNull, or } from 'drizzle-orm';

import type {
  PurchaseRepository,
  NewPendingPurchase,
  PurchaseWebhookUpdate,
} from '../../../application/ports/purchase-repository.js';
import { accessIsCurrent, type Purchase, type PurchaseStatus } from '../../../domain/commerce/purchase.js';
import type { AppDatabase } from '../connection.js';
import { accessGrants, drafts, purchases, users } from '../schema.js';

export class SqlitePurchaseRepository implements PurchaseRepository {
  constructor(private readonly database: AppDatabase, private readonly adminEmail?: string) {}

  createPendingPurchase(purchase: NewPendingPurchase): void {
    this.database
      .insert(purchases)
      .values({
        id: purchase.id,
        draftId: purchase.draftId,
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

    const purchase = byCallback ?? byProviderOrder;
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
        ? transaction
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, update.grantEmail))
            .get()
        : undefined;

      transaction
        .update(purchases)
        .set({
          status,
          ownerUserId: current.ownerUserId ?? existingUser?.id ?? null,
          providerOrderId: current.providerOrderId ?? update.providerOrderId,
          customerEmail: update.customerEmail ?? current.customerEmail,
          updatedAt: update.now,
        })
        .where(eq(purchases.id, update.purchaseId))
        .run();

      if (update.grantEmail && status === 'paid' && current.status !== 'paid' && !isTerminal) {
        transaction
          .insert(accessGrants)
          .values({
            id: randomUUID(),
            purchaseId: update.purchaseId,
            userId: existingUser?.id ?? null,
            customerEmail: update.grantEmail,
            status: 'active',
            grantedAt: update.now,
            expiresAt: update.accessExpiresAt ?? null,
            revokedAt: null,
            updatedAt: update.now,
          })
          .onConflictDoUpdate({
            target: accessGrants.purchaseId,
            set: {
              userId: existingUser?.id ?? null,
              customerEmail: update.grantEmail,
              status: 'active',
              revokedAt: null,
              updatedAt: update.now,
            },
          })
          .run();

        if (existingUser) {
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
      .where(eq(accessGrants.userId, userId))
      .orderBy(purchases.createdAt)
      .all()
      .map((row) => ({
        ...row,
        expiresAt: row.expiresAt ?? null,
        accessStatus: accessIsCurrent({ status: row.accessStatus, expiresAt: row.expiresAt ?? null }, now)
          ? 'active' as const
          : row.accessStatus === 'active' ? 'none' as const : row.accessStatus,
      }));
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

    return Boolean(
      this.database
        .select({ id: accessGrants.id })
        .from(accessGrants)
        .innerJoin(purchases, eq(purchases.id, accessGrants.purchaseId))
        .where(
          and(
            eq(accessGrants.status, 'active'),
            eq(purchases.status, 'paid'),
            eq(purchases.draftId, draftId),
            or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
          ),
        )
        .get(),
    );
  }
}
