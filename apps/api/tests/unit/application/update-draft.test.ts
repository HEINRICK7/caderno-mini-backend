import { describe, expect, it, vi } from 'vitest';

import { DraftNotFoundError } from '../../../src/application/errors.js';
import { updateDraft } from '../../../src/application/use-cases/update-draft.js';

const draft = {
  id: 'opaque-draft-id',
  templateId: 'mensagem-exemplo',
  templateVersion: 2,
  data: { message: 'Antes' },
  createdAt: new Date('2026-10-31T10:00:00.000Z'),
  updatedAt: new Date('2026-10-31T11:00:00.000Z'),
};

describe('updateDraft', () => {
  it('replaces the data and preserves the draft identity and template version', () => {
    const update = vi.fn();
    const updatedAt = new Date('2026-10-31T12:00:00.000Z');

    const updated = updateDraft(
      { id: draft.id, data: { message: 'Depois' } },
      {
        drafts: { findById: vi.fn().mockReturnValue(draft), insert: vi.fn(), update },
        clock: () => updatedAt,
      },
    );

    expect(updated).toEqual({ ...draft, data: { message: 'Depois' }, updatedAt });
    expect(update).toHaveBeenCalledWith(updated);
  });

  it('never moves updatedAt backwards when the system clock regresses', () => {
    const update = vi.fn();

    const updated = updateDraft(
      { id: draft.id, data: { message: 'Depois' } },
      {
        drafts: { findById: vi.fn().mockReturnValue(draft), insert: vi.fn(), update },
        clock: () => new Date('2026-10-31T10:30:00.000Z'),
      },
    );

    expect(updated.updatedAt).toEqual(draft.updatedAt);
  });

  it('raises a stable not found error and does not save', () => {
    const update = vi.fn();

    expect(() =>
      updateDraft(
        { id: 'missing', data: {} },
        {
          drafts: { findById: vi.fn().mockReturnValue(undefined), insert: vi.fn(), update },
          clock: () => new Date('2026-10-31T12:00:00.000Z'),
        },
      ),
    ).toThrow(DraftNotFoundError);

    expect(update).not.toHaveBeenCalled();
  });
});
