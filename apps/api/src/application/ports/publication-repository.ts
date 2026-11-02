import type { Publication } from '../../domain/publication/publication.js';

export type PublishDraft = {
  id: string;
  draftId: string;
  ownerUserId: string;
  slug: string;
  now: Date;
};

export interface PublicationRepository {
  publish(input: PublishDraft): Publication | undefined;
  findPublishedBySlug(slug: string): Publication | undefined;
  unpublish(draftId: string, ownerUserId: string, now: Date): void;
}
