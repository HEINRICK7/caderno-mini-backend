import { and, desc, eq, isNull, or } from 'drizzle-orm';

import type { DraftRepository } from '../../../application/ports/draft-repository.js';
import type { Draft } from '../../../domain/drafts/draft.js';
import type { AppDatabase } from '../connection.js';
import { drafts, templates } from '../schema.js';

export class SqliteDraftRepository implements DraftRepository {
  constructor(private readonly db: AppDatabase) {}

  findById(id: string): Draft | undefined {
    const row = this.db.select().from(drafts).where(eq(drafts.id, id)).get();
    return row ? toDraft(row) : undefined;
  }

  findByIdForUser(id: string, userId?: string): Draft | undefined {
    const row = this.db.select().from(drafts).where(eq(drafts.id, id)).get();
    if (!row || (row.ownerUserId && row.ownerUserId !== userId)) {
      return undefined;
    }

    if (!row.ownerUserId && userId) {
      const claimed = this.db
        .update(drafts)
        .set({ ownerUserId: userId })
        .where(and(eq(drafts.id, id), isNull(drafts.ownerUserId)))
        .run();
      if (claimed.changes === 0) return undefined;
    }

    return toDraft(row);
  }

  listOwnedByUser(userId: string): Array<{ id: string; templateId: string; templateName: string; updatedAt: Date }> {
    return this.db
      .select({
        id: drafts.id,
        templateId: drafts.templateId,
        templateName: templates.name,
        updatedAt: drafts.updatedAt,
      })
      .from(drafts)
      .leftJoin(templates, and(eq(templates.id, drafts.templateId), eq(templates.version, drafts.templateVersion)))
      .where(eq(drafts.ownerUserId, userId))
      .orderBy(desc(drafts.updatedAt))
      .all()
      .map((draft) => ({
        ...draft,
        templateName: draft.templateName ?? draft.templateId,
      }));
  }

  transferOwnership(id: string, currentOwnerUserId: string, nextOwnerUserId: string): boolean {
    const result = this.db
      .update(drafts)
      .set({ ownerUserId: nextOwnerUserId })
      .where(and(
        eq(drafts.id, id),
        eq(drafts.ownerUserId, currentOwnerUserId),
      ))
      .run();
    return result.changes > 0;
  }

  insert(draft: Draft, ownerUserId?: string): void {
    this.db
      .insert(drafts)
      .values({ ...draft, ...(ownerUserId ? { ownerUserId } : {}) })
      .run();
  }

  update(draft: Draft): void {
    this.db
      .update(drafts)
      .set({ data: draft.data, updatedAt: draft.updatedAt })
      .where(eq(drafts.id, draft.id))
      .run();
  }

  updateForUser(draft: Draft, userId?: string): boolean {
    const ownerPredicate = userId
      ? or(isNull(drafts.ownerUserId), eq(drafts.ownerUserId, userId))
      : isNull(drafts.ownerUserId);
    const result = this.db
      .update(drafts)
      .set({ data: draft.data, updatedAt: draft.updatedAt, ...(userId ? { ownerUserId: userId } : {}) })
      .where(and(eq(drafts.id, draft.id), ownerPredicate))
      .run();
    return result.changes > 0;
  }
}

function toDraft(row: typeof drafts.$inferSelect): Draft {
  return {
    id: row.id,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
