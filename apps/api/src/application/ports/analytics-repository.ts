export type AnalyticsEventName =
  | 'landing_viewed'
  | 'template_viewed'
  | 'template_selected'
  | 'preview_viewed'
  | 'whatsapp_share_clicked'
  | 'draft_created'
  | 'draft_updated'
  | 'login_link_requested'
  | 'checkout_started'
  | 'purchase_paid'
  | 'publication_published'
  | 'publication_unpublished'
  | 'export_generated';

export type AnalyticsEventRecord = {
  id: string;
  dedupeKey: string;
  name: AnalyticsEventName;
  userId?: string;
  draftId?: string;
  purchaseId?: string;
  publicationId?: string;
  templateId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  referrerHost?: string;
  occurredAt: Date;
};

export type AnalyticsSummary = {
  eventCounts: Array<{ name: string; count: number }>;
  purchaseSources: Array<{
    source: string | null;
    medium: string | null;
    campaign: string | null;
    purchases: number;
  }>;
};

export interface AnalyticsRepository {
  record(event: AnalyticsEventRecord): boolean;
  summarize(period: { from: Date; to: Date }): AnalyticsSummary;
}
