import type { NewWebhookEvent, WebhookEvent } from '../dto/payment-event.js';

export interface WebhookInboxRepository {
  insert(events: NewWebhookEvent[]): number;
  claimPending(limit: number, now: Date): WebhookEvent[];
  markProcessed(id: string, now: Date): void;
  markFailed(id: string, attemptCount: number, errorCode: string): void;
}
