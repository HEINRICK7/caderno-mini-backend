import type { Template } from '../../domain/templates/template.js';
import type { JsonObject } from '../../domain/shared/json-value.js';

export type AdminTemplate = Template & { publicationStatus: 'draft' | 'published' | 'archived' };

export interface AdminTemplateRepository {
  findAll(): AdminTemplate[];
  findByIdAndVersion(id: string, version: number): AdminTemplate | undefined;
  createDraft(input: {
    id: string;
    name: string;
    description: string | null;
    definition: JsonObject;
    createdAt: Date;
  }): AdminTemplate;
  updateDraft(input: {
    id: string;
    version: number;
    name: string;
    description: string | null;
    definition: JsonObject;
  }): AdminTemplate | undefined;
  publishDraft(input: { id: string; version: number; expectedDefinition: JsonObject }): AdminTemplate | undefined;
  archiveActive(id: string): boolean;
}
