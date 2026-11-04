import { and, eq, gt, lte } from 'drizzle-orm';

import type { DemoPublicationRepository, NewDemoPublication } from '../../../application/ports/demo-publication-repository.js';
import type { AppDatabase } from '../connection.js';
import { demoPublications } from '../schema.js';

export class SqliteDemoPublicationRepository implements DemoPublicationRepository {
  constructor(private readonly database: AppDatabase) {}

  refreshOrCreateByCategory(input: NewDemoPublication, now: Date) {
    return this.database.transaction((transaction) => {
      transaction.delete(demoPublications).where(lte(demoPublications.expiresAt, now)).run();
      const existing = transaction
        .select()
        .from(demoPublications)
        .where(and(eq(demoPublications.visitorHash, input.visitorHash), eq(demoPublications.category, input.category)))
        .get();
      if (existing) {
        transaction.update(demoPublications)
          .set({
            draftId: input.draftId,
            templateId: input.templateId,
            templateVersion: input.templateVersion,
            templateName: input.templateName,
            templateDescription: input.templateDescription,
            templateDefinition: input.templateDefinition,
            data: input.data,
            createdAt: input.createdAt,
            expiresAt: input.expiresAt,
          })
          .where(eq(demoPublications.slug, existing.slug))
          .run();
        const refreshed = transaction
          .select()
          .from(demoPublications)
          .where(eq(demoPublications.slug, existing.slug))
          .get();
        if (!refreshed || refreshed.expiresAt <= now) throw new Error('Could not refresh the demo publication.');
        return { publication: toDemoPublication(refreshed), created: false };
      }

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
