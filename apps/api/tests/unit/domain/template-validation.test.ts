import { describe, expect, it } from 'vitest';

import {
  InvalidTemplateDefinitionError,
  TemplateInputValidationError,
} from '../../../src/domain/templates/errors.js';
import { validateTemplateInput } from '../../../src/domain/templates/validate-template-input.js';

describe('validateTemplateInput', () => {
  const definition = {
    fields: [
      { id: 'message', type: 'text', required: true, maxLength: 40 },
      { id: 'style', type: 'select', options: ['warm', 'formal'] },
      { id: 'includeDate', type: 'boolean' },
    ],
  };

  it('accepts values matching the versioned template definition', () => {
    expect(() =>
      validateTemplateInput(definition, {
        message: 'Feliz aniversário!',
        style: 'warm',
        includeDate: false,
      }),
    ).not.toThrow();
  });

  it('rejects unknown fields, missing required values, invalid types, and values outside options', () => {
    expect(() => validateTemplateInput(definition, { message: '', unknown: 'value' })).toThrow(
      TemplateInputValidationError,
    );
    expect(() => validateTemplateInput(definition, { message: 'x'.repeat(41) })).toThrow(
      TemplateInputValidationError,
    );
    expect(() => validateTemplateInput(definition, { message: 'ok', style: 'neon' })).toThrow(
      TemplateInputValidationError,
    );
    expect(() => validateTemplateInput(definition, { message: 'ok', includeDate: 'false' })).toThrow(
      TemplateInputValidationError,
    );
  });

  it('rejects malformed template definitions instead of silently accepting data', () => {
    expect(() => validateTemplateInput({ fields: [{ id: 'x', type: 'unsupported' }] }, { x: 'value' }))
      .toThrow(InvalidTemplateDefinitionError);
  });
});
