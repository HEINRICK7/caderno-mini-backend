export type IncomingPaymentEvent = {
  dedupeKey: string;
  sideEffectDedupeKey?: string;
  eventType: string;
  providerOrderId?: string;
  providerStatus?: string;
  callbackToken?: string;
  customerEmail?: string;
  productId?: string;
  offerId?: string;
  offerType?: string;
  planFrequency?: string;
  amountMinor?: number | null;
  currency?: string;
  occurredAt?: string;
};

/** @deprecated Use IncomingPaymentEvent for normalized events from any payment provider. */
export type IncomingCaktoEvent = IncomingPaymentEvent;

export type NewWebhookEvent = {
  id: string;
  dedupeKey: string;
  sideEffectDedupeKey: string | null;
  eventType: string;
  providerOrderId: string | null;
  providerStatus: string | null;
  callbackHash: string | null;
  customerEmail: string | null;
  productId: string | null;
  offerId: string | null;
  offerType: string | null;
  planFrequency: string | null;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string | null;
  receivedAt: Date;
};

export type WebhookEvent = Omit<NewWebhookEvent, 'receivedAt'> & {
  attemptCount: number;
};
