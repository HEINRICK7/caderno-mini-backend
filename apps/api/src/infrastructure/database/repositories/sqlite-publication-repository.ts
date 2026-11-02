import { and, eq } from 'drizzle-orm';

import type { PublicationRepository, PublishDraft } from '../../../application/ports/publication-repository.js';
import type { Publication } from '../../../domain/publication/publication.js';
import type { AppDatabase } from '../connection.js';
import { publications } from '../schema.js';

export class SqlitePublicationRepository implements PublicationRepository {
  constructor(private readonly database: AppDatabase) {}

  publish(input: PublishDraft): Publication | undefined {
    return this.database.transaction((transaction) => {
      const current = transaction
        .select()
        .from(publications)
        .where(eq(publications.draftId, input.draftId))
        .get();

      if (current && current.ownerUserId !== input.ownerUserId) {
        return undefined;
      }

      if (current) {
        transaction
          .update(publications)
          .set({ status: 'published', publishedAt: input.now, unpublishedAt: null, updatedAt: input.now })
          .where(and(eq(publications.id, current.id), eq(publications.ownerUserId, input.ownerUserId)))
          .run();
        return toPublication(
          transaction.select().from(publications).where(eq(publications.id, current.id)).get()!,
        );
      }

      const created = transaction
        .insert(publications)
        .values({
          id: input.id,
          draftId: input.draftId,
          ownerUserId: input.ownerUserId,
          slug: input.slug,
          status: 'published',
          publishedAt: input.now,
          unpublishedAt: null,
          updatedAt: input.now,
        })
        .returning()
        .get();
      return created ? toPublication(created) : undefined;
    });
  }

  findPublishedBySlug(slug: string): Publication | undefined {
    const row = this.database
      .select()
      .from(publications)
      .where(and(eq(publications.slug, slug), eq(publications.status, 'published')))
      .get();
    return row ? toPublication(row) : undefined;
  }

  unpublish(draftId: string, ownerUserId: string, now: Date): void {
    this.database
      .update(publications)
      .set({ status: 'unpublished', unpublishedAt: now, updatedAt: now })
      .where(
        and(
          eq(publications.draftId, draftId),
          eq(publications.ownerUserId, ownerUserId),
          eq(publications.status, 'published'),
        ),
      )
      .run();
  }
}

function toPublication(row: typeof publications.$inferSelect): Publication {
  return {
    id: row.id,
    draftId: row.draftId,
    ownerUserId: row.ownerUserId,
    slug: row.slug,
    status: row.status,
    publishedAt: row.publishedAt,
    unpublishedAt: row.unpublishedAt,
    updatedAt: row.updatedAt,
  };
}
