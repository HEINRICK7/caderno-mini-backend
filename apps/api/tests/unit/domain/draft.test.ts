import { describe, expect, it } from 'vitest';

import { createDraft, replaceDraftData } from '../../../src/domain/drafts/draft.js';

describe('draft domain rules', () => {
  it('creates a draft with its pinned template and independent data', () => {
    const data = { message: 'Olá', metadata: { theme: 'blue' } };
    const now = new Date('2026-10-31T12:00:00.000Z');
    const draft = createDraft({
      id: 'opaque-id',
      templateId: 'mensagem-exemplo',
      templateVersion: 4,
      data,
      now,
    });

    data.metadata.theme = 'red';

    expect(draft).toEqual({
      id: 'opaque-id',
      templateId: 'mensagem-exemplo',
      templateVersion: 4,
      data: { message: 'Olá', metadata: { theme: 'blue' } },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('replaces data without changing identity or moving updatedAt backwards', () => {
    const current = createDraft({
      id: 'opaque-id',
      templateId: 'mensagem-exemplo',
      templateVersion: 2,
      data: { message: 'Antes' },
      now: new Date('2026-10-31T12:00:00.000Z'),
    });
    const updated = replaceDraftData(
      current,
      { message: 'Depois' },
      new Date('2026-10-31T11:00:00.000Z'),
    );

    expect(updated).toEqual({
      ...current,
      data: { message: 'Depois' },
    });
  });
});
