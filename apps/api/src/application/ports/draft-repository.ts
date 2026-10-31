import type { Draft } from '../../domain/drafts/draft.js';

export interface DraftRepository {
  findById(id: string): Draft | undefined;
  insert(draft: Draft): void;
  update(draft: Draft): void;
}
