import { and, asc, eq, lt, or } from 'drizzle-orm';

import type {
  NewWebhookEvent,
  WebhookEvent,
} from '../../../application/dto/payment-event.js';
import type { WebhookInboxRepository } from '../../../application/ports/webhook-inbox-repository.js';
import type { AppDatabase } from '../connection.js';
import { webhookEvents } from '../schema.js';

const PROCESSING_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;

export class SqliteWebhookInboxRepository implements WebhookInboxRepository {
  constructor(private readonly database: AppDatabase) {}

  insert(events: NewWebhookEvent[]): number {
    return this.database.transaction((transaction) => {
      let accepted = 0;
      for (const event of events) {
        const inserted = transaction
          .insert(webhookEvents)
          .values({
            ...event,
            processingStatus: 'pending',
            attemptCount: 0,
            processingStartedAt: null,
            processedAt: null,
            lastErrorCode: null,
          })
          .onConflictDoNothing()
          .returning({ id: webhookEvents.id })
          .get();
        if (inserted) {
          accepted += 1;
        }
      }
      return accepted;
    });
  }

  claimPending(limit: number, now: Date): WebhookEvent[] {
    const leaseCutoff = new Date(now.getTime() - PROCESSING_LEASE_MS);
    return this.database.transaction((transaction) => {
      const pending = transaction
        .select()
        .from(webhookEvents)
        .where(
          or(
            eq(webhookEvents.processingStatus, 'pending'),
            and(
              eq(webhookEvents.processingStatus, 'processing'),
              lt(webhookEvents.processingStartedAt, leaseCutoff),
            ),
          ),
        )
        .orderBy(asc(webhookEvents.receivedAt))
        .limit(limit)
        .all();

      for (const event of pending) {
        transaction
          .update(webhookEvents)
          .set({
            processingStatus: 'processing',
            attemptCount: event.attemptCount + 1,
            processingStartedAt: now,
          })
          .where(eq(webhookEvents.id, event.id))
          .run();
      }

      return pending.map((event) => ({
        id: event.id,
        dedupeKey: event.dedupeKey,
        sideEffectDedupeKey: event.sideEffectDedupeKey,
        eventType: event.eventType,
        providerOrderId: event.providerOrderId,
        providerStatus: event.providerStatus,
        callbackHash: event.callbackHash,
        customerEmail: event.customerEmail,
        productId: event.productId,
        offerId: event.offerId,
        offerType: event.offerType,
        planFrequency: event.planFrequency,
        amountMinor: event.amountMinor,
        currency: event.currency,
        occurredAt: event.occurredAt,
        attemptCount: event.attemptCount + 1,
      }));
    });
  }

  markProcessed(id: string, now: Date): void {
    this.database
      .update(webhookEvents)
      .set({
        processingStatus: 'processed',
        processingStartedAt: null,
        processedAt: now,
        customerEmail: null,
        callbackHash: null,
        lastErrorCode: null,
      })
      .where(eq(webhookEvents.id, id))
      .run();
  }

  markFailed(id: string, attemptCount: number, errorCode: string): void {
    this.database
      .update(webhookEvents)
      .set({
        processingStatus: attemptCount >= MAX_ATTEMPTS ? 'failed' : 'pending',
        processingStartedAt: null,
        lastErrorCode: errorCode.slice(0, 80),
      })
      .where(eq(webhookEvents.id, id))
      .run();
  }
}
