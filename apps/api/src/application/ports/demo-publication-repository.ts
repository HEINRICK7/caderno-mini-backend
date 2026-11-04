import type { JsonObject } from '../../domain/shared/json-value.js';
import type { TemplateHomeCategory } from '../../domain/templates/template-catalog.js';

export type DemoPublication = {
  slug: string;
  category: TemplateHomeCategory;
  draftId: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  templateDescription: string | null;
  templateDefinition: JsonObject;
  data: JsonObject;
  createdAt: Date;
  expiresAt: Date;
};

export type NewDemoPublication = DemoPublication & { visitorHash: string };

export interface DemoPublicationRepository {
  refreshOrCreateByCategory(input: NewDemoPublication, now: Date): { publication: DemoPublication; created: boolean };
  findActiveBySlug(slug: string, now: Date): DemoPublication | undefined;
}
