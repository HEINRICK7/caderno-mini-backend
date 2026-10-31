import { eq } from 'drizzle-orm';

import type { DraftRepository } from '../../../application/ports/draft-repository.js';
import type { Draft } from '../../../domain/drafts/draft.js';
import type { AppDatabase } from '../connection.js';
import { drafts } from '../schema.js';

export class SqliteDraftRepository implements DraftRepository {
  constructor(private readonly db: AppDatabase) {}

  findById(id: string): Draft | undefined {
    return this.db.select().from(drafts).where(eq(drafts.id, id)).get();
  }

  insert(draft: Draft): void {
    this.db.insert(drafts).values(draft).run();
  }

  update(draft: Draft): void {
    this.db
      .update(drafts)
      .set({ data: draft.data, updatedAt: draft.updatedAt })
      .where(eq(drafts.id, draft.id))
      .run();
  }
}
