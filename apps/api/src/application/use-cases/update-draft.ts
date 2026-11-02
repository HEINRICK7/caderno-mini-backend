import { replaceDraftData, type Draft } from '../../domain/drafts/draft.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import { DraftNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { TemplateRepository } from '../ports/template-repository.js';
import { TemplateNotFoundError } from '../errors.js';
import { validateTemplateInput } from '../../domain/templates/validate-template-input.js';

export type UpdateDraftInput = {
  id: string;
  data: JsonObject;
  userId?: string;
};

export function updateDraft(
  input: UpdateDraftInput,
  dependencies: { drafts: DraftRepository; templates: TemplateRepository; clock: () => Date },
): Draft {
  const current = dependencies.drafts.findByIdForUser(input.id, input.userId);

  if (!current) {
    throw new DraftNotFoundError();
  }

  const template = dependencies.templates.findByIdAndVersion(current.templateId, current.templateVersion);
  if (!template) {
    throw new TemplateNotFoundError();
  }
  validateTemplateInput(template.definition, input.data);

  const updated = replaceDraftData(current, input.data, dependencies.clock());
  if (!dependencies.drafts.updateForUser(updated, input.userId)) {
    throw new DraftNotFoundError();
  }
  return updated;
}
