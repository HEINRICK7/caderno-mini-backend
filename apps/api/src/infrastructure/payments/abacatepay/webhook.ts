import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  InvalidAbacatePayWebhookPayloadError,
  UnauthorizedAbacatePayWebhookError,
} from '../../../application/errors.js';
import type { IncomingPaymentEvent } from '../../../application/dto/payment-event.js';
import { normalizeEmail } from '../../../domain/identity/identity.js';

export type AbacatePayWebhookHeaders = {
  secret?: string;
  querySecret?: string;
  signature?: string;
};

export function parseAbacatePayWebhook(
  rawBody: Buffer,
  headers: AbacatePayWebhookHeaders,
  options: { secret: string; signatureKey: string },
): IncomingPaymentEvent[] {
  // AbacatePay sends the configured secret in both places; verify the query
  // value explicitly and reject conflicting/missing copies.
  if (
    !constantTimeStringEqual(headers.querySecret ?? '', options.secret) ||
    !constantTimeStringEqual(headers.secret ?? '', options.secret) ||
    !verifySignature(rawBody, headers.signature ?? '', options.signatureKey)
  ) {
    throw new UnauthorizedAbacatePayWebhookError();
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    throw new InvalidAbacatePayWebhookPayloadError();
  }

  if (!isEnvelope(envelope)) {
    throw new InvalidAbacatePayWebhookPayloadError();
  }

  return [normalizeEvent(envelope)];
}

type AbacatePayEnvelope = {
  id: string;
  event: string;
  apiVersion: 2;
  data: Record<string, unknown>;
};

function isEnvelope(value: unknown): value is AbacatePayEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' && candidate.id.length > 0 && candidate.id.length <= 200 &&
    typeof candidate.event === 'string' && candidate.event.length > 0 && candidate.event.length <= 100 &&
    candidate.apiVersion === 2 &&
    typeof candidate.data === 'object' && candidate.data !== null && !Array.isArray(candidate.data)
  );
}

function normalizeEvent(envelope: AbacatePayEnvelope): IncomingPaymentEvent {
  const data = envelope.data;
  const checkout = asRecord(data.checkout);
  const subscription = asRecord(data.subscription);
  const payment = asRecord(data.payment);
  if (
    checkout && 'externalId' in checkout && checkout.externalId !== null &&
    (typeof checkout.externalId !== 'string' || !validCallbackToken(checkout.externalId))
  ) {
    throw new InvalidAbacatePayWebhookPayloadError();
  }
  if (SUPPORTED_EVENTS.has(envelope.event)) {
    if (!checkout || !stringValue(checkout.id)) throw new InvalidAbacatePayWebhookPayloadError();
    if (envelope.event.startsWith('subscription.') && (!subscription || !stringValue(subscription.id))) {
      throw new InvalidAbacatePayWebhookPayloadError();
    }
    if (
      ['subscription.completed', 'subscription.renewed', 'subscription.payment_failed'].includes(envelope.event) &&
      (!payment || !stringValue(payment.id))
    ) {
      throw new InvalidAbacatePayWebhookPayloadError();
    }
  }

  const customer = asRecord(data.customer);
  const items = Array.isArray(checkout?.items) ? checkout.items : [];
  const productId = stringValue(asRecord(items[0])?.id);
  const checkoutId = stringValue(checkout?.id);
  const callbackToken = validCallbackToken(checkout?.externalId);
  const checkoutStatus = stringValue(checkout?.status);
  const subscriptionId = stringValue(subscription?.id);
  const subscriptionStatus = stringValue(subscription?.status);
  const frequency = stringValue(subscription?.frequency)?.toUpperCase();
  const paymentStatus = stringValue(payment?.status);
  const cancelPolicy = stringValue(subscription?.cancelPolicy)?.toUpperCase();
  const isUpSell = checkout?.isUpSell === true;
  const amountMinor = integerAmount(payment?.paidAmount) ?? integerAmount(payment?.amount)
    ?? integerAmount(checkout?.paidAmount) ?? integerAmount(checkout?.amount);
  const customerEmail = validEmail(customer?.email);
  const occurredAt = isoDate(payment?.updatedAt) ?? isoDate(checkout?.updatedAt)
    ?? isoDate(subscription?.updatedAt) ?? isoDate(checkout?.createdAt);
  const normalized = normalizedEventType(envelope.event, {
    checkoutStatus,
    checkoutFrequency: stringValue(checkout?.frequency)?.toUpperCase(),
    isUpSell,
    subscriptionStatus,
    subscriptionId,
    paymentId: stringValue(payment?.id),
    checkoutId,
    frequency,
    paymentStatus,
    paymentAmountMinor: amountMinor,
    cancelPolicy,
  });

  return {
    dedupeKey: `abacatepay:event:${envelope.id}`,
    ...(normalized.sideEffectDedupeKey ? { sideEffectDedupeKey: normalized.sideEffectDedupeKey } : {}),
    eventType: normalized.eventType,
    ...(checkoutId ? { providerOrderId: checkoutId } : {}),
    ...(normalized.providerStatus ? { providerStatus: normalized.providerStatus } : {}),
    ...(callbackToken ? { callbackToken } : {}),
    ...(customerEmail ? { customerEmail } : {}),
    ...(productId ? { productId } : {}),
    ...(envelope.event.startsWith('subscription.') ? { offerType: 'subscription' } : { offerType: 'main' }),
    ...(frequency ? { planFrequency: frequency } : {}),
    ...(amountMinor !== undefined ? { amountMinor } : {}),
    currency: 'BRL',
    ...(occurredAt ? { occurredAt } : {}),
  };
}

const SUPPORTED_EVENTS = new Set([
  'checkout.completed', 'checkout.refunded', 'checkout.disputed', 'checkout.lost',
  'subscription.completed', 'subscription.renewed', 'subscription.cancelled', 'subscription.payment_failed',
]);

function normalizedEventType(
  event: string,
  details: {
    checkoutStatus: string | undefined;
    checkoutFrequency: string | undefined;
    isUpSell: boolean;
    subscriptionStatus: string | undefined;
    subscriptionId: string | undefined;
    paymentId: string | undefined;
    checkoutId: string | undefined;
    frequency: string | undefined;
    paymentStatus: string | undefined;
    paymentAmountMinor: number | undefined;
    cancelPolicy: string | undefined;
  },
): { eventType: string; providerStatus?: string; sideEffectDedupeKey?: string } {
  if (event === 'checkout.completed') {
    if (details.isUpSell || details.checkoutFrequency === 'SUBSCRIPTION') {
      return { eventType: 'abacatepay_duplicate_or_upsell' };
    }
    return details.checkoutStatus === 'PAID' && details.paymentAmountMinor !== undefined
      ? {
          eventType: 'purchase_approved',
          providerStatus: 'paid',
          sideEffectDedupeKey: `abacatepay:checkout.completed:${details.checkoutId ?? 'unknown'}`,
        }
      : { eventType: event };
  }
  if (event === 'checkout.refunded') {
    return details.checkoutStatus === 'REFUNDED'
      ? { eventType: 'refund', providerStatus: 'refunded', sideEffectDedupeKey: `abacatepay:checkout.refunded:${details.checkoutId ?? 'unknown'}` }
      : { eventType: event };
  }
  if (event === 'checkout.disputed') {
    if (details.checkoutStatus === 'UNDER_DISPUTE') {
      return { eventType: 'refund_requested', providerStatus: 'under_dispute', sideEffectDedupeKey: `abacatepay:checkout.disputed:under_dispute:${details.checkoutId ?? 'unknown'}` };
    }
    if (details.checkoutStatus === 'REFUNDED') {
      return { eventType: 'chargeback', providerStatus: 'chargedback', sideEffectDedupeKey: `abacatepay:checkout.disputed:refunded:${details.checkoutId ?? 'unknown'}` };
    }
    return { eventType: event };
  }
  if (event === 'checkout.lost') {
    return { eventType: 'chargeback', providerStatus: 'chargedback', sideEffectDedupeKey: `abacatepay:checkout.lost:${details.checkoutId ?? 'unknown'}` };
  }
  if (event === 'subscription.completed' || event === 'subscription.renewed') {
    const paid = (details.paymentStatus === 'APPROVED' || details.paymentStatus === 'PAID') &&
      details.paymentAmountMinor !== undefined;
    if (details.subscriptionStatus !== 'ACTIVE' || details.frequency !== 'ANNUALLY' || !paid) {
      return { eventType: event };
    }
    return {
      eventType: event === 'subscription.completed' ? 'subscription_approved' : 'subscription_renewed',
      ...(details.paymentStatus ? { providerStatus: details.paymentStatus.toLowerCase() } : {}),
      sideEffectDedupeKey: event === 'subscription.completed'
        ? `abacatepay:subscription.completed:${details.subscriptionId ?? 'unknown'}`
        : `abacatepay:subscription.payment:${details.paymentId ?? 'unknown'}`,
    };
  }
  if (event === 'subscription.payment_failed') {
    return {
      eventType: 'subscription_payment_failed',
      ...(details.paymentStatus ? { providerStatus: details.paymentStatus.toLowerCase() } : {}),
    };
  }
  if (event === 'subscription.cancelled') {
    return {
      eventType: 'subscription_cancelled',
      ...(details.cancelPolicy ? { providerStatus: details.cancelPolicy } : {}),
      ...(details.cancelPolicy === 'NOW' || details.cancelPolicy === 'NEXT_CYCLE'
        ? { sideEffectDedupeKey: `abacatepay:subscription.cancelled:${details.subscriptionId ?? 'unknown'}:${details.cancelPolicy}` }
        : {}),
    };
  }
  return { eventType: event };
}

function verifySignature(rawBody: Buffer, signature: string, signatureKey: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', signatureKey).update(rawBody).digest('base64');
  const receivedBuffer = Buffer.from(signature, 'ascii');
  const expectedBuffer = Buffer.from(expected, 'ascii');
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length > 0 && leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : undefined;
}

function validCallbackToken(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 255 && /^[A-Za-z0-9._~-]+$/.test(value)
    ? value
    : undefined;
}

function validEmail(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 254) return undefined;
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function integerAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}
