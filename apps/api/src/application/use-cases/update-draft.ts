import { replaceDraftData, type Draft } from '../../domain/drafts/draft.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import { DraftNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';

export type UpdateDraftInput = {
  id: string;
  data: JsonObject;
};

export function updateDraft(
  input: UpdateDraftInput,
  dependencies: { drafts: DraftRepository; clock: () => Date },
): Draft {
  const current = dependencies.drafts.findById(input.id);

  if (!current) {
    throw new DraftNotFoundError();
  }

  const updated = replaceDraftData(current, input.data, dependencies.clock());
  dependencies.drafts.update(updated);
  return updated;
}
