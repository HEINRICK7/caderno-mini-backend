import { randomUUID } from 'node:crypto';

import type { AppDatabase } from '../infrastructure/database/connection.js';
import { SqliteDraftRepository } from '../infrastructure/database/repositories/sqlite-draft-repository.js';
import { SqliteTemplateRepository } from '../infrastructure/database/repositories/sqlite-template-repository.js';
import { createDraft } from '../application/use-cases/create-draft.js';
import { getDraft } from '../application/use-cases/get-draft.js';
import { listTemplates } from '../application/use-cases/list-templates.js';
import { updateDraft } from '../application/use-cases/update-draft.js';

export type ApplicationServices = ReturnType<typeof createApplicationServices>;

export function createApplicationServices(
  db: AppDatabase,
  options: { idGenerator?: () => string; clock?: () => Date } = {},
) {
  const templates = new SqliteTemplateRepository(db);
  const drafts = new SqliteDraftRepository(db);
  const idGenerator = options.idGenerator ?? randomUUID;
  const clock = options.clock ?? (() => new Date());

  return {
    listTemplates: () => listTemplates({ templates }),
    createDraft: (input: Parameters<typeof createDraft>[0]) =>
      createDraft(input, { templates, drafts, idGenerator, clock }),
    getDraft: (input: Parameters<typeof getDraft>[0]) => getDraft(input, { drafts }),
    updateDraft: (input: Parameters<typeof updateDraft>[0]) =>
      updateDraft(input, { drafts, clock }),
  };
}
