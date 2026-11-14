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
            accountStatus: 'active',
            emailVerifiedAt: input.now,
            createdAt: input.now,
          })
          .returning()
          .get();
      }

      if (user.accountStatus !== 'active') {
        return undefined;
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
        if (!purchasedDraft.id) continue;
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

      return { user: toDomainUser(user), expiresAt: input.expiresAt };
    });
  }

  findOrCreateAdminTestUser(input: { email: string; userId: string; now: Date }): User | undefined {
    return this.database.transaction((transaction) => {
      let user = transaction.select().from(users).where(eq(users.email, input.email)).get();

      if (!user) {
        transaction
          .insert(users)
          .values({
            id: input.userId,
            email: input.email,
            accountStatus: 'active',
            emailVerifiedAt: input.now,
            createdAt: input.now,
          })
          .onConflictDoNothing()
          .run();
        user = transaction.select().from(users).where(eq(users.email, input.email)).get();
      }

      if (!user || user.accountStatus !== 'active') return undefined;
      return toDomainUser(user);
    });
  }

  updateCustomerProfile(input: { userId: string; name: string; whatsapp: string; birthDate: string }): User | undefined {
    const user = this.database
      .update(users)
      .set({ name: input.name, whatsapp: input.whatsapp, birthDate: input.birthDate })
      .where(and(eq(users.id, input.userId), eq(users.accountStatus, 'active')))
      .returning()
      .get();
    return user ? toDomainUser(user) : undefined;
  }

  findSessionByTokenHash(tokenHash: string, now: Date): User | undefined {
    const result = this.database
      .select()
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          eq(users.accountStatus, 'active'),
        ),
      )
      .get();

    return result ? toDomainUser(result.users) : undefined;
  }

  revokeSessionByTokenHash(tokenHash: string, now: Date): void {
    this.database
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
      .run();
  }
}

function toDomainUser(user: typeof users.$inferSelect): User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    whatsapp: user.whatsapp,
    birthDate: user.birthDate,
    profileComplete: Boolean(user.name && user.whatsapp && user.birthDate),
    createdAt: user.createdAt,
  };
}
