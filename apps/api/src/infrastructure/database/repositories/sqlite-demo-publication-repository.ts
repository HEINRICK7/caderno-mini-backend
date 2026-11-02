import { and, eq, gt, lte } from 'drizzle-orm';

import type { DemoPublicationRepository, NewDemoPublication } from '../../../application/ports/demo-publication-repository.js';
import type { AppDatabase } from '../connection.js';
import { demoPublications } from '../schema.js';

export class SqliteDemoPublicationRepository implements DemoPublicationRepository {
  constructor(private readonly database: AppDatabase) {}

  createOncePerCategory(input: NewDemoPublication, now: Date) {
    return this.database.transaction((transaction) => {
      transaction.delete(demoPublications).where(lte(demoPublications.expiresAt, now)).run();
      const existing = transaction
        .select()
        .from(demoPublications)
        .where(and(eq(demoPublications.visitorHash, input.visitorHash), eq(demoPublications.category, input.category)))
        .get();
      if (existing) return { publication: toDemoPublication(existing), created: false };

      transaction.insert(demoPublications).values(input).onConflictDoNothing().run();
      const stored = transaction
        .select()
        .from(demoPublications)
        .where(and(eq(demoPublications.visitorHash, input.visitorHash), eq(demoPublications.category, input.category)))
        .get();
      if (!stored || stored.expiresAt <= now) throw new Error('Could not persist the demo publication.');
      return { publication: toDemoPublication(stored), created: stored.slug === input.slug };
    });
  }

  findActiveBySlug(slug: string, now: Date) {
    const row = this.database
      .select()
      .from(demoPublications)
      .where(and(eq(demoPublications.slug, slug), gt(demoPublications.expiresAt, now)))
      .get();
    return row ? toDemoPublication(row) : undefined;
  }
}

function toDemoPublication(row: typeof demoPublications.$inferSelect) {
  return {
    slug: row.slug,
    category: row.category,
    draftId: row.draftId,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateName: row.templateName,
    templateDescription: row.templateDescription,
    templateDefinition: row.templateDefinition,
    data: row.data,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
