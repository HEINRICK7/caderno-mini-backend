import { and, eq, gt, isNull } from 'drizzle-orm';

import type {
  ConsumeMagicLink,
  IdentityRepository,
  NewMagicLink,
} from '../../../application/ports/identity-repository.js';
import type { User } from '../../../domain/identity/identity.js';
import type { AppDatabase } from '../connection.js';
import { accessGrants, drafts, magicLoginTokens, purchases, sessions, users } from '../schema.js';

export class SqliteIdentityRepository implements IdentityRepository {
  constructor(private readonly database: AppDatabase) {}

  createMagicLink(magicLink: NewMagicLink): void {
    this.database.transaction((transaction) => {
      transaction
        .delete(magicLoginTokens)
        .where(and(eq(magicLoginTokens.email, magicLink.email), isNull(magicLoginTokens.consumedAt)))
        .run();
      transaction.insert(magicLoginTokens).values(magicLink).run();
    });
  }

  deleteMagicLink(tokenHash: string): void {
    this.database.delete(magicLoginTokens).where(eq(magicLoginTokens.tokenHash, tokenHash)).run();
  }

  consumeMagicLinkAndCreateSession(
    input: ConsumeMagicLink,
  ): { user: User; expiresAt: Date } | undefined {
    return this.database.transaction((transaction) => {
      const consumed = transaction
        .update(magicLoginTokens)
        .set({ consumedAt: input.now })
        .where(
          and(
            eq(magicLoginTokens.tokenHash, input.tokenHash),
            isNull(magicLoginTokens.consumedAt),
            gt(magicLoginTokens.expiresAt, input.now),
          ),
        )
        .returning({ email: magicLoginTokens.email })
        .get();

      if (!consumed) {
        return undefined;
      }

      let user = transaction
        .select()
        .from(users)
        .where(eq(users.email, consumed.email))
        .get();

      if (!user) {
        user = transaction
          .insert(users)
          .values({
            id: input.userId,
            email: consumed.email,
            emailVerifiedAt: input.now,
            createdAt: input.now,
          })
          .returning()
          .get();
      }

      transaction
        .update(accessGrants)
        .set({ userId: user.id })
        .where(and(eq(accessGrants.customerEmail, consumed.email), isNull(accessGrants.userId)))
        .run();

      transaction
        .update(purchases)
        .set({ ownerUserId: user.id })
        .where(and(eq(purchases.customerEmail, consumed.email), isNull(purchases.ownerUserId)))
        .run();

      const purchasedDrafts = transaction
        .select({ id: purchases.draftId })
        .from(accessGrants)
        .innerJoin(purchases, eq(accessGrants.purchaseId, purchases.id))
        .where(eq(accessGrants.userId, user.id))
        .all();
      for (const purchasedDraft of purchasedDrafts) {
        transaction
          .update(drafts)
          .set({ ownerUserId: user.id })
          .where(and(eq(drafts.id, purchasedDraft.id), isNull(drafts.ownerUserId)))
          .run();
      }

      transaction
        .insert(sessions)
        .values({
          id: input.sessionId,
          userId: user.id,
          tokenHash: input.sessionTokenHash,
          expiresAt: input.expiresAt,
          revokedAt: null,
          createdAt: input.now,
        })
        .run();

      return {
        user: { id: user.id, email: user.email, createdAt: user.createdAt },
        expiresAt: input.expiresAt,
      };
    });
  }

  findSessionByTokenHash(tokenHash: string, now: Date): User | undefined {
    const result = this.database
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .get();

    return result;
  }

  revokeSessionByTokenHash(tokenHash: string, now: Date): void {
    this.database
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .run();
  }
}
