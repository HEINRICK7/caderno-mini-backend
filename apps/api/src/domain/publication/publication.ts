export type Publication = {
  id: string;
  draftId: string;
  ownerUserId: string;
  slug: string;
  status: 'published' | 'unpublished';
  publishedAt: Date;
  unpublishedAt: Date | null;
  updatedAt: Date;
};
