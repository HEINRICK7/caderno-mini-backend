import type { Draft } from '../../domain/drafts/draft.js';
import { DraftNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';

export function getDraft(
  input: { id: string; userId?: string },
  dependencies: { drafts: DraftRepository },
): Draft {
  const draft = dependencies.drafts.findByIdForUser(input.id, input.userId);

  if (!draft) {
    throw new DraftNotFoundError();
  }

  return draft;
}
