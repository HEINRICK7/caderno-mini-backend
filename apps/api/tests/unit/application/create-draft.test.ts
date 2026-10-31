import { describe, expect, it, vi } from 'vitest';

import { TemplateNotFoundError } from '../../../src/application/errors.js';
import { createDraft } from '../../../src/application/use-cases/create-draft.js';

const template = {
  id: 'mensagem-exemplo',
  version: 3,
  name: 'Modelo de exemplo',
  description: null,
  definition: { fields: [] },
  isActive: true,
  createdAt: new Date('2026-10-01T10:00:00.000Z'),
};

describe('createDraft', () => {
  it('stores a draft against the current active template version', () => {
    const insert = vi.fn();
    const now = new Date('2026-10-31T12:00:00.000Z');

    const draft = createDraft(
      { templateId: template.id, data: { message: 'Olá' } },
      {
        templates: { findActiveById: vi.fn().mockReturnValue(template) },
        drafts: { insert, update: vi.fn(), findById: vi.fn() },
        idGenerator: () => 'opaque-draft-id',
        clock: () => now,
      },
    );

    expect(draft).toEqual({
      id: 'opaque-draft-id',
      templateId: template.id,
      templateVersion: 3,
      data: { message: 'Olá' },
      createdAt: now,
      updatedAt: now,
    });
    expect(insert).toHaveBeenCalledWith(draft);
  });

  it('rejects an unknown or inactive template without saving', () => {
    const insert = vi.fn();

    expect(() =>
      createDraft(
        { templateId: 'missing', data: {} },
        {
          templates: { findActiveById: vi.fn().mockReturnValue(undefined) },
          drafts: { insert, update: vi.fn(), findById: vi.fn() },
          idGenerator: () => 'unused-id',
          clock: () => new Date('2026-10-31T12:00:00.000Z'),
        },
      ),
    ).toThrow(TemplateNotFoundError);

    expect(insert).not.toHaveBeenCalled();
  });
});
