import type { JsonObject } from '../../domain/shared/json-value.js';
import { InvalidTemplateDefinitionError } from '../../domain/templates/errors.js';
import { validateTemplateDefinition } from '../../domain/templates/validate-template-input.js';
import type { AdminTemplateRepository } from '../ports/admin-template-repository.js';

export function listAdminTemplates(dependencies: { templates: AdminTemplateRepository }) {
  return dependencies.templates.findAll();
}

export function createAdminTemplateDraft(
  input: { id: string; name: string; description: string | null; definition: JsonObject },
  dependencies: { templates: AdminTemplateRepository; clock: () => Date },
) {
  return dependencies.templates.createDraft({ ...input, createdAt: dependencies.clock() });
}

export function updateAdminTemplateDraft(
  input: { id: string; version: number; name: string; description: string | null; definition: JsonObject },
  dependencies: { templates: AdminTemplateRepository },
) {
  return dependencies.templates.updateDraft(input);
}

export function validateAdminTemplateDefinition(
  input: { definition: JsonObject },
) {
  validateTemplateDefinition(input.definition);
  if (!input.definition.catalog || !input.definition.visual || !input.definition.card) {
    throw new InvalidTemplateDefinitionError();
  }
  return { valid: true as const };
}

export function publishAdminTemplateDraft(
  input: { id: string; version: number },
  dependencies: { templates: AdminTemplateRepository },
) {
  const draft = dependencies.templates.findByIdAndVersion(input.id, input.version);
  if (!draft || draft.publicationStatus !== 'draft') return undefined;
  validateAdminTemplateDefinition({ definition: draft.definition });
  return dependencies.templates.publishDraft({ ...input, expectedDefinition: draft.definition });
}

export function archiveAdminTemplate(
  input: { id: string },
  dependencies: { templates: AdminTemplateRepository },
) {
  return dependencies.templates.archiveActive(input.id);
}
