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
const template = {
  id: draft.templateId,
  version: draft.templateVersion,
  name: 'Mensagem',
  description: null,
  definition: { fields: [{ id: 'message', type: 'text' }] },
  isActive: false,
  createdAt: draft.createdAt,
};

describe('updateDraft', () => {
  it('replaces the data and preserves the draft identity and template version', () => {
    const updateForUser = vi.fn().mockReturnValue(true);
    const updatedAt = new Date('2026-10-31T12:00:00.000Z');

    const updated = updateDraft(
      { id: draft.id, data: { message: 'Depois' } },
      {
        drafts: { findById: vi.fn(), findByIdForUser: vi.fn().mockReturnValue(draft), insert: vi.fn(), update: vi.fn(), updateForUser },
        templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion: vi.fn().mockReturnValue(template) },
        clock: () => updatedAt,
      },
    );

    expect(updated).toEqual({ ...draft, data: { message: 'Depois' }, updatedAt });
    expect(updateForUser).toHaveBeenCalledWith(updated, undefined);
  });

  it('never moves updatedAt backwards when the system clock regresses', () => {
    const updateForUser = vi.fn().mockReturnValue(true);

    const updated = updateDraft(
      { id: draft.id, data: { message: 'Depois' } },
      {
        drafts: { findById: vi.fn(), findByIdForUser: vi.fn().mockReturnValue(draft), insert: vi.fn(), update: vi.fn(), updateForUser },
        templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion: vi.fn().mockReturnValue(template) },
        clock: () => new Date('2026-10-31T10:30:00.000Z'),
      },
    );

    expect(updated.updatedAt).toEqual(draft.updatedAt);
  });

  it('raises a stable not found error and does not save', () => {
    const updateForUser = vi.fn();

    expect(() =>
      updateDraft(
        { id: 'missing', data: {} },
        {
          drafts: { findById: vi.fn(), findByIdForUser: vi.fn().mockReturnValue(undefined), insert: vi.fn(), update: vi.fn(), updateForUser },
          templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion: vi.fn() },
          clock: () => new Date('2026-10-31T12:00:00.000Z'),
        },
      ),
    ).toThrow(DraftNotFoundError);

    expect(updateForUser).not.toHaveBeenCalled();
  });
});
