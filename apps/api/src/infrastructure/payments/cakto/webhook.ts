import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { InvalidCaktoWebhookError } from '../../../application/errors.js';
import { normalizeEmail } from '../../../domain/identity/identity.js';
import type { IncomingCaktoEvent } from '../../../application/dto/payment-event.js';

export type CaktoWebhookHeaders = {
  timestamp?: string;
  signature?: string;
};

type CaktoEnvelope = {
  secret: string;
  event: string;
  data: unknown;
};

export function parseCaktoWebhook(
  rawBody: Buffer,
  headers: CaktoWebhookHeaders,
  options: { secret?: string; secrets?: readonly string[]; now?: Date },
): IncomingCaktoEvent[] {
  const secrets = [...new Set([...(options.secrets ?? []), ...(options.secret ? [options.secret] : [])])];
  const matchedSecret = secrets.length > 0 ? authenticatedSecret(rawBody, headers, secrets, options.now) : undefined;
  if (!headers.timestamp || !headers.signature || !matchedSecret) {
    throw new InvalidCaktoWebhookError();
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    throw new InvalidCaktoWebhookError();
  }

  if (!isCaktoEnvelope(envelope) || !constantTimeStringEqual(envelope.secret, matchedSecret)) {
    throw new InvalidCaktoWebhookError();
  }

  const dataEntries = Array.isArray(envelope.data) ? envelope.data : [envelope.data];
  if (dataEntries.length === 0 || dataEntries.length > 50) {
    throw new InvalidCaktoWebhookError();
  }

  return dataEntries.map((data) => normalizeEvent(envelope.event, data));
}

function authenticatedSecret(
  rawBody: Buffer,
  headers: CaktoWebhookHeaders,
  secrets: readonly string[],
  now?: Date,
): string | undefined {
  const timestamp = headers.timestamp ?? '';
  if (!/^\d{10}$/.test(timestamp)) {
    return undefined;
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor((now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 5 * 60) {
    return undefined;
  }

  const v1Signature = (headers.signature ?? '')
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('v1='));
  const receivedHex = v1Signature?.slice(3);
  if (!receivedHex || !/^[a-f\d]{64}$/i.test(receivedHex)) {
    return undefined;
  }

  const received = Buffer.from(receivedHex, 'hex');
  let matched: string | undefined;
  for (const secret of secrets) {
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      matched = secret;
    }
  }
  return matched;
}

function isCaktoEnvelope(value: unknown): value is CaktoEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.secret === 'string' &&
    typeof candidate.event === 'string' &&
    candidate.event.length > 0 &&
    candidate.event.length <= 80 &&
    candidate.data !== undefined
  );
}

function normalizeEvent(eventType: string, input: unknown): IncomingCaktoEvent {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidCaktoWebhookError();
  }
  const data = input as Record<string, unknown>;

  if (eventType === 'checkout_abandonment') {
    const offer = asRecord(data.offer);
    const offerId = stringValue(offer?.id);
    const occurredAt = isoDate(data.createdAt);
    const identity = [
      normalizeEmail(stringOrEmpty(data.customerEmail)),
      stringOrEmpty(offer?.id),
      stringOrEmpty(data.createdAt),
    ].join(':');
    return {
      eventType,
      dedupeKey: digest(`${eventType}:${identity}`),
      ...(offerId ? { offerId } : {}),
      ...(occurredAt ? { occurredAt } : {}),
    };
  }

  const providerOrderId = stringValue(data.id);
  if (!providerOrderId) {
    throw new InvalidCaktoWebhookError();
  }

  const customer = asRecord(data.customer);
  const product = asRecord(data.product);
  const offer = asRecord(data.offer);
  const callbackToken = validCallbackToken(data.callback);
  const customerEmail = validEmail(customer?.email);
  const amountMinor =
    typeof data.amount === 'number' && Number.isFinite(data.amount)
      ? Math.round(data.amount * 100)
      : null;
  const providerStatus = stringValue(data.status);
  const productId = stringValue(product?.id);
  const offerId = stringValue(offer?.id);
  const offerType = stringValue(data.offer_type);
  const currency = stringValue(data.currency);
  const occurredAt = isoDate(data.paidAt) ?? isoDate(data.createdAt);
  const payloadHash = digest(JSON.stringify(data));

  return {
    eventType,
    dedupeKey: digest(`${providerOrderId}:${eventType}:${payloadHash}`),
    providerOrderId,
    ...(providerStatus ? { providerStatus } : {}),
    ...(callbackToken ? { callbackToken } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(productId ? { productId } : {}),
    ...(offerId ? { offerId } : {}),
    ...(offerType ? { offerType } : {}),
    amountMinor,
    ...(currency ? { currency } : {}),
    ...(occurredAt ? { occurredAt } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function validCallbackToken(value: unknown): string | undefined {
  if (
    typeof value === 'string' &&
    value.length <= 255 &&
    /^[A-Za-z0-9._~-]+$/.test(value)
  ) {
    return value;
  }
  return undefined;
}

function validEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) {
    return undefined;
  }
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
