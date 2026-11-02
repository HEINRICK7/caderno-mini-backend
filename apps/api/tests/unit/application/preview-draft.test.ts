import { describe, expect, it, vi } from 'vitest';

import { DraftNotFoundError } from '../../../src/application/errors.js';
import { previewDraft } from '../../../src/application/use-cases/preview-draft.js';

const draft = {
  id: 'draft-123',
  templateId: 'mensagem-exemplo',
  templateVersion: 2,
  data: { message: 'Olá' },
  createdAt: new Date('2026-10-31T10:00:00.000Z'),
  updatedAt: new Date('2026-10-31T10:00:00.000Z'),
};

const template = {
  id: draft.templateId,
  version: draft.templateVersion,
  name: 'Mensagem',
  description: '',
  definition: { fields: [{ id: 'message', type: 'text' }] },
  isActive: true,
  createdAt: draft.createdAt,
};

describe('previewDraft', () => {
  it('renders a stored draft version without requiring a license', async () => {
    const findByIdForUser = vi.fn().mockReturnValue(draft);
    const findByIdAndVersion = vi.fn().mockReturnValue(template);
    const image = Buffer.from('png');
    const renderPreview = vi.fn().mockResolvedValue(image);

    await expect(
      previewDraft(
        { draftId: draft.id, userId: 'owner-1' },
        {
          drafts: { findById: vi.fn(), findByIdForUser, insert: vi.fn(), update: vi.fn(), updateForUser: vi.fn() },
          templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion },
          renderer: { render: vi.fn(), renderPreview },
        },
      ),
    ).resolves.toBe(image);

    expect(findByIdForUser).toHaveBeenCalledWith(draft.id, 'owner-1');
    expect(findByIdAndVersion).toHaveBeenCalledWith(draft.templateId, draft.templateVersion);
    expect(renderPreview).toHaveBeenCalledWith(template, draft.data);
  });

  it('hides drafts the caller cannot access', async () => {
    await expect(
      previewDraft(
        { draftId: draft.id },
        {
          drafts: {
            findById: vi.fn(),
            findByIdForUser: vi.fn().mockReturnValue(undefined),
            insert: vi.fn(),
            update: vi.fn(),
            updateForUser: vi.fn(),
          },
          templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion: vi.fn() },
          renderer: { render: vi.fn(), renderPreview: vi.fn() },
        },
      ),
    ).rejects.toThrow(DraftNotFoundError);
  });

  it('hides drafts whose template version is unavailable', async () => {
    await expect(
      previewDraft(
        { draftId: draft.id },
        {
          drafts: {
            findById: vi.fn(),
            findByIdForUser: vi.fn().mockReturnValue(draft),
            insert: vi.fn(),
            update: vi.fn(),
            updateForUser: vi.fn(),
          },
          templates: { findActive: vi.fn(), findActiveById: vi.fn(), findByIdAndVersion: vi.fn() },
          renderer: { render: vi.fn(), renderPreview: vi.fn() },
        },
      ),
    ).rejects.toThrow(DraftNotFoundError);
  });
});
