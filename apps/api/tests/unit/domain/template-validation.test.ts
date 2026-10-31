import { describe, expect, it } from 'vitest';

import {
  InvalidTemplateDefinitionError,
  TemplateInputValidationError,
} from '../../../src/domain/templates/errors.js';
import {
  validateTemplateDefinition,
  validateTemplateInput,
} from '../../../src/domain/templates/validate-template-input.js';

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

  it('accepts a declarative visual style with controlled values', () => {
    expect(() =>
      validateTemplateDefinition({
        fields: [{ id: 'message', type: 'text', label: 'Mensagem', placeholder: 'Escreva aqui' }],
        visual: {
          layout: 'editorial',
          background: '#F7F1E8',
          surface: '#FFFFFF',
          accent: '#8B6245',
          heading: '#30271F',
          text: '#2F2A27',
          muted: '#705A49',
          headingFont: 'serif',
          bodyFont: 'sans',
          frame: 'single',
        },
      }),
    ).not.toThrow();
  });

  it('accepts a semantic card composition with a field binding', () => {
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'recipientName', type: 'text', label: 'Nome', required: true }],
      card: {
        illustration: 'wave',
        heading: 'Olá, {{recipientName}}!',
        message: 'Que bom ter você por aqui!',
        footer: 'heart',
      },
    })).not.toThrow();
  });

  it('rejects card bindings to missing fields and unknown illustration tokens', () => {
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'recipientName', type: 'text' }],
      card: { illustration: 'wave', heading: 'Olá, {{unknown}}!', footer: 'heart' },
    })).toThrow(InvalidTemplateDefinitionError);
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'recipientName', type: 'text' }],
      card: { illustration: 'photo', heading: 'Olá, {{recipientName}}!', footer: 'heart' },
    })).toThrow(InvalidTemplateDefinitionError);
  });

  it('rejects arbitrary HTML, CSS, and unsupported visual tokens in catalog definitions', () => {
    expect(() => validateTemplateDefinition({ fields: [], html: '<script>alert(1)</script>' })).toThrow(
      InvalidTemplateDefinitionError,
    );
    expect(() =>
      validateTemplateDefinition({
        fields: [],
        visual: {
          layout: 'card',
          background: '#fff; color: red',
          surface: '#FFFFFF',
          accent: '#8B6245',
          heading: '#30271F',
          text: '#2F2A27',
          muted: '#705A49',
          headingFont: 'serif',
          bodyFont: 'sans',
          frame: 'none',
        },
      }),
    ).toThrow(InvalidTemplateDefinitionError);
  });
});
