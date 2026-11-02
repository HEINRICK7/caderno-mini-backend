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

  it('accepts optional company logo and product image fields stored by asset ID', () => {
    expect(() => validateTemplateDefinition({
      fields: [
        { id: 'businessName', type: 'text', required: true },
        { id: 'businessLogo', type: 'image', maxBytes: 131072 },
        { id: 'productImage', type: 'image', maxBytes: 131072 },
      ],
      card: {
        illustration: 'shopping-bag-heart',
        heading: 'Obrigado, {{businessName}}!',
        brand: { businessNameFieldId: 'businessName', logoFieldId: 'businessLogo' },
        footer: 'none',
      },
    })).not.toThrow();

    expect(() => validateTemplateInput(
      { fields: [{ id: 'businessLogo', type: 'image', maxBytes: 131072 }] },
      { businessLogo: '7b7d828b-f189-496a-b59b-9fae6a9b8531' },
    )).not.toThrow();
  });

  it('rejects URLs and inline image data from draft input', () => {
    const definition = { fields: [{ id: 'businessLogo', type: 'image', maxBytes: 131072 }] };
    for (const value of [
      'https://example.com/logo.png',
      'data:image/png;base64,iVBORw0KGgo=',
      'not-an-asset-id',
    ]) {
      expect(() => validateTemplateInput(definition, { businessLogo: value })).toThrow(TemplateInputValidationError);
    }
  });

  it('rejects a logo card binding to a non-image field', () => {
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'businessName', type: 'text' }, { id: 'businessLogo', type: 'text' }],
      card: {
        illustration: 'wave',
        heading: 'Olá, {{businessName}}!',
        brand: { businessNameFieldId: 'businessName', logoFieldId: 'businessLogo' },
        footer: 'none',
      },
    })).toThrow(InvalidTemplateDefinitionError);
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

  it('accepts structured detail rows, currency values, and a preview action', () => {
    expect(() => validateTemplateDefinition({
      fields: [
        { id: 'recipientName', type: 'text', required: true },
        { id: 'productName', type: 'text' },
        { id: 'purchaseAmount', type: 'number', format: 'currency' },
        { id: 'detailsUrl', type: 'url' },
      ],
      card: {
        illustration: 'shopping-bag-heart',
        heading: 'Obrigado, {{recipientName}}!',
        message: 'Sua compra foi registrada com sucesso.',
        details: [
          { label: 'Produto', value: '{{productName}}', icon: 'package' },
          { label: 'Valor', value: '{{purchaseAmount}}', icon: 'credit-card', format: 'currency' },
        ],
        action: { label: 'Ver detalhes da compra', hrefFieldId: 'detailsUrl' },
        footer: 'none',
      },
    })).not.toThrow();
  });

  it('accepts date-formatted details and multiple actions bound to URL fields', () => {
    expect(() => validateTemplateDefinition({
      fields: [
        { id: 'scheduledAt', type: 'date' },
        { id: 'approveLink', type: 'url' },
        { id: 'rejectLink', type: 'url' },
      ],
      card: {
        illustration: 'approval-hourglass',
        heading: 'Olá, cliente!',
        details: [{ label: 'Data da realização', value: '{{scheduledAt}}', format: 'date' }],
        actions: [
          { label: 'Sim, quero', hrefFieldId: 'approveLink' },
          { label: 'Agora não', hrefFieldId: 'rejectLink' },
        ],
        footer: 'none',
      },
    })).not.toThrow();
  });

  it('rejects date formatting for non-date fields and cards that mix singular and multiple actions', () => {
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'message', type: 'text' }],
      card: {
        illustration: 'wave',
        heading: 'Olá!',
        details: [{ label: 'Data', value: '{{message}}', format: 'date' }],
        footer: 'none',
      },
    })).toThrow(InvalidTemplateDefinitionError);
    expect(() => validateTemplateDefinition({
      fields: [],
      card: {
        illustration: 'wave',
        heading: 'Olá!',
        action: { label: 'Uma opção' },
        actions: [{ label: 'Outra opção' }],
        footer: 'none',
      },
    })).toThrow(InvalidTemplateDefinitionError);
  });

  it('rejects detail bindings to missing fields and action bindings to non-URL fields', () => {
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'recipientName', type: 'text' }],
      card: {
        illustration: 'wave',
        heading: 'Olá, {{recipientName}}!',
        details: [{ label: 'Produto', value: '{{unknown}}' }],
        footer: 'none',
      },
    })).toThrow(InvalidTemplateDefinitionError);
    expect(() => validateTemplateDefinition({
      fields: [{ id: 'recipientName', type: 'text' }],
      card: {
        illustration: 'wave',
        heading: 'Olá, {{recipientName}}!',
        action: { label: 'Abrir detalhes', hrefFieldId: 'recipientName' },
        footer: 'none',
      },
    })).toThrow(InvalidTemplateDefinitionError);
  });

  it('accepts catalog segment/category metadata and rejects values outside the contract', () => {
    expect(() => validateTemplateDefinition({
      fields: [],
      catalog: { segment: 'both', category: 'Cobrança' },
    })).not.toThrow();
    expect(() => validateTemplateDefinition({
      fields: [],
      catalog: { segment: 'anything', category: 'Cobrança' },
    })).toThrow(InvalidTemplateDefinitionError);
    expect(() => validateTemplateDefinition({
      fields: [],
      catalog: { segment: 'both', category: 'Fora do catálogo' },
    })).toThrow(InvalidTemplateDefinitionError);
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
