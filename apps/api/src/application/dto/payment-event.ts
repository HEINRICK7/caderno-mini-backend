export type IncomingCaktoEvent = {
  dedupeKey: string;
  eventType: string;
  providerOrderId?: string;
  providerStatus?: string;
  callbackToken?: string;
  customerEmail?: string;
  productId?: string;
  offerId?: string;
  offerType?: string;
  amountMinor?: number | null;
  currency?: string;
  occurredAt?: string;
};

export type NewWebhookEvent = {
  id: string;
  dedupeKey: string;
  eventType: string;
  providerOrderId: string | null;
  providerStatus: string | null;
  callbackHash: string | null;
  customerEmail: string | null;
  productId: string | null;
  offerId: string | null;
  offerType: string | null;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: string | null;
  receivedAt: Date;
};

export type WebhookEvent = Omit<NewWebhookEvent, 'receivedAt'> & {
  attemptCount: number;
};
