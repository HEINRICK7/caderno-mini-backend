import type { Draft } from '../../domain/drafts/draft.js';

export interface DraftRepository {
  findById(id: string): Draft | undefined;
  findByIdForUser(id: string, userId?: string): Draft | undefined;
  insert(draft: Draft, ownerUserId?: string): void;
  update(draft: Draft): void;
  updateForUser(draft: Draft, userId?: string): boolean;
}
