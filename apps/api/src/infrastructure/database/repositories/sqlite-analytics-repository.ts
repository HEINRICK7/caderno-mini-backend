import { and, count, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import type {
  AnalyticsEventRecord,
  AnalyticsRepository,
  AnalyticsSummary,
} from '../../../application/ports/analytics-repository.js';
import type { AppDatabase } from '../connection.js';
import { analyticsEvents } from '../schema.js';

export class SqliteAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly database: AppDatabase) {}

  record(event: AnalyticsEventRecord): boolean {
    const result = this.database
      .insert(analyticsEvents)
      .values({
        id: event.id,
        dedupeKey: event.dedupeKey,
        name: event.name,
        userId: event.userId ?? null,
        draftId: event.draftId ?? null,
        purchaseId: event.purchaseId ?? null,
        publicationId: event.publicationId ?? null,
        templateId: event.templateId ?? null,
        source: event.source ?? null,
        medium: event.medium ?? null,
        campaign: event.campaign ?? null,
        referrerHost: event.referrerHost ?? null,
        occurredAt: event.occurredAt,
      })
      .onConflictDoNothing({ target: analyticsEvents.dedupeKey })
      .run();
    return result.changes > 0;
  }

  summarize(period: { from: Date; to: Date }): AnalyticsSummary {
    const range = and(
      gte(analyticsEvents.occurredAt, period.from),
      lte(analyticsEvents.occurredAt, period.to),
    );
    const eventCounts = this.database
      .select({ name: analyticsEvents.name, count: count(analyticsEvents.id) })
      .from(analyticsEvents)
      .where(range)
      .groupBy(analyticsEvents.name)
      .all();

    const checkoutEvents = alias(analyticsEvents, 'checkout_events');
    const purchaseSources = this.database
      .select({
        source: checkoutEvents.source,
        medium: checkoutEvents.medium,
        campaign: checkoutEvents.campaign,
        purchases: count(analyticsEvents.id),
      })
      .from(analyticsEvents)
      .leftJoin(
        checkoutEvents,
        and(
          eq(checkoutEvents.purchaseId, analyticsEvents.purchaseId),
          eq(checkoutEvents.name, 'checkout_started'),
        ),
      )
      .where(and(range, eq(analyticsEvents.name, 'purchase_paid')))
      .groupBy(checkoutEvents.source, checkoutEvents.medium, checkoutEvents.campaign)
      .all();

    return { eventCounts, purchaseSources };
  }
}
