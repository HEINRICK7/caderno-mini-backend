import type { Draft } from '../../domain/drafts/draft.js';
import { DraftNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';

export function getDraft(input: { id: string }, dependencies: { drafts: DraftRepository }): Draft {
  const draft = dependencies.drafts.findById(input.id);

  if (!draft) {
    throw new DraftNotFoundError();
  }

  return draft;
}
