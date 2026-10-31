import { randomUUID } from 'node:crypto';

import { DraftNotFoundError, TemplateNotFoundError, AnalyticsRangeError } from '../errors.js';
import type {
  AnalyticsEventName,
  AnalyticsEventRecord,
  AnalyticsRepository,
  AnalyticsSummary,
} from '../ports/analytics-repository.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { TemplateRepository } from '../ports/template-repository.js';

const clientEventNames = new Set<AnalyticsEventName>([
  'landing_viewed',
  'template_viewed',
  'template_selected',
  'preview_viewed',
  'whatsapp_share_clicked',
]);
const MAX_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

export type TrackClientEventInput = {
  eventId: string;
  name: AnalyticsEventName;
  userId?: string;
  draftId?: string;
  templateId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  referrerUrl?: string;
};

export function trackClientEvent(
  input: TrackClientEventInput,
  dependencies: {
    analytics: AnalyticsRepository;
    drafts: DraftRepository;
    templates: TemplateRepository;
    clock?: () => Date;
  },
): { accepted: boolean } {
  if (!clientEventNames.has(input.name)) {
    throw new Error('Client analytics event is not allowed.');
  }
  if (input.draftId && !dependencies.drafts.findByIdForUser(input.draftId, input.userId)) {
    throw new DraftNotFoundError();
  }
  if (input.templateId && !dependencies.templates.findActiveById(input.templateId)) {
    throw new TemplateNotFoundError();
  }

  const referrerHost = toReferrerHost(input.referrerUrl);
  const event: AnalyticsEventRecord = {
    id: randomUUID(),
    dedupeKey: `client:${input.eventId}`,
    name: input.name,
    occurredAt: dependencies.clock?.() ?? new Date(),
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    ...(input.templateId ? { templateId: input.templateId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.medium ? { medium: input.medium } : {}),
    ...(input.campaign ? { campaign: input.campaign } : {}),
    ...(referrerHost ? { referrerHost } : {}),
  };
  return { accepted: dependencies.analytics.record(event) };
}

export function recordServerEvent(
  input: Omit<AnalyticsEventRecord, 'id' | 'dedupeKey' | 'occurredAt'> & {
    entityKey: string;
    occurredAt?: Date;
  },
  dependencies: { analytics: AnalyticsRepository; generateId?: () => string; clock?: () => Date },
): boolean {
  const { entityKey, occurredAt, ...attributes } = input;
  return dependencies.analytics.record({
    ...attributes,
    id: (dependencies.generateId ?? randomUUID)(),
    dedupeKey: `server:${input.name}:${entityKey}`,
    occurredAt: occurredAt ?? dependencies.clock?.() ?? new Date(),
  });
}

export function getAnalyticsSummary(
  input: { from: Date; to: Date },
  dependencies: { analytics: AnalyticsRepository },
): AnalyticsSummary {
  if (input.from.getTime() >= input.to.getTime() || input.to.getTime() - input.from.getTime() > MAX_PERIOD_MS) {
    throw new AnalyticsRangeError();
  }
  return dependencies.analytics.summarize(input);
}

function toReferrerHost(referrerUrl?: string): string | undefined {
  if (!referrerUrl) return undefined;
  try {
    const url = new URL(referrerUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    return url.hostname.slice(0, 253).toLowerCase();
  } catch {
    return undefined;
  }
}
