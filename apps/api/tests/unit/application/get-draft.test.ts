import { describe, expect, it, vi } from 'vitest';

import { DraftNotFoundError } from '../../../src/application/errors.js';
import { getDraft } from '../../../src/application/use-cases/get-draft.js';

const draft = {
  id: 'opaque-draft-id',
  templateId: 'mensagem-exemplo',
  templateVersion: 1,
  data: { message: 'Olá' },
  createdAt: new Date('2026-10-31T10:00:00.000Z'),
  updatedAt: new Date('2026-10-31T10:00:00.000Z'),
};

describe('getDraft', () => {
  it('returns the stored draft', () => {
    const findByIdForUser = vi.fn().mockReturnValue(draft);

    expect(
      getDraft({ id: draft.id }, { drafts: { findById: vi.fn(), findByIdForUser, insert: vi.fn(), update: vi.fn(), updateForUser: vi.fn() } }),
    ).toEqual(draft);
    expect(findByIdForUser).toHaveBeenCalledWith(draft.id, undefined);
  });

  it('raises a stable not found error', () => {
    expect(() =>
      getDraft(
        { id: 'missing' },
        { drafts: { findById: vi.fn(), findByIdForUser: vi.fn().mockReturnValue(undefined), insert: vi.fn(), update: vi.fn(), updateForUser: vi.fn() } },
      ),
    ).toThrow(DraftNotFoundError);
  });
});
