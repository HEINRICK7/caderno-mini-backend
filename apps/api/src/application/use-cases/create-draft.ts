import { createDraft as makeDraft, type Draft } from '../../domain/drafts/draft.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import { TemplateNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { TemplateRepository } from '../ports/template-repository.js';

export type CreateDraftInput = {
  templateId: string;
  data: JsonObject;
};

export type CreateDraftDependencies = {
  templates: TemplateRepository;
  drafts: DraftRepository;
  idGenerator: () => string;
  clock: () => Date;
};

export function createDraft(
  input: CreateDraftInput,
  dependencies: CreateDraftDependencies,
): Draft {
  const template = dependencies.templates.findActiveById(input.templateId);

  if (!template) {
    throw new TemplateNotFoundError();
  }

  const draft = makeDraft({
    id: dependencies.idGenerator(),
    templateId: template.id,
    templateVersion: template.version,
    data: input.data,
    now: dependencies.clock(),
  });

  dependencies.drafts.insert(draft);
  return draft;
}
