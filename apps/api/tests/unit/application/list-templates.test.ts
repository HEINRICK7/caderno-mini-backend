import { describe, expect, it, vi } from 'vitest';

import { listTemplates } from '../../../src/application/use-cases/list-templates.js';

describe('listTemplates', () => {
  it('returns the active catalog from the repository', () => {
    const templates = [
      {
        id: 'mensagem-exemplo',
        version: 1,
        name: 'Modelo de exemplo',
        description: null,
        definition: { fields: [] },
        isActive: true,
        createdAt: new Date('2026-10-01T10:00:00.000Z'),
      },
    ];
    const findActive = vi.fn().mockReturnValue(templates);

    expect(listTemplates({ templates: { findActive, findActiveById: vi.fn() } })).toEqual(templates);
    expect(findActive).toHaveBeenCalledOnce();
  });
});
