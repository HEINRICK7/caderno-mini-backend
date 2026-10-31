import type { JsonObject, JsonValue } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError } from './errors.js';

export type TemplateCard = {
  illustration: 'wave' | 'shopping-bag-heart' | 'installment-calendar' | 'due-calendar' | 'overdue-warning' | 'pix-qr' | 'payment-check' | 'trophy' | 'service-clipboard' | 'service-seal' | 'gift' | 'product-tag' | 'offer-tag' | 'collection-bag' | 'reactivation-heart' | 'approval-hourglass';
  heading: string;
  message?: string;
  footer: 'heart';
};

type TemplateField = { id: string; type: string };

const illustrations = new Set<TemplateCard['illustration']>([
  'wave',
  'shopping-bag-heart',
  'installment-calendar',
  'due-calendar',
  'overdue-warning',
  'pix-qr',
  'payment-check',
  'trophy',
  'service-clipboard',
  'service-seal',
  'gift',
  'product-tag',
  'offer-tag',
  'collection-bag',
  'reactivation-heart',
  'approval-hourglass',
]);
const cardKeys = new Set(['illustration', 'heading', 'message', 'footer']);
const fieldIdPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function validateTemplateCard(definition: JsonObject, fields: TemplateField[]): void {
  resolveTemplateCard(definition, fields);
}

export function resolveTemplateCard(
  definition: JsonObject,
  fields?: TemplateField[],
): TemplateCard | undefined {
  const raw = definition.card;
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || Object.keys(raw).some((key) => !cardKeys.has(key))) {
    throw new InvalidTemplateDefinitionError();
  }

  const { illustration, heading, message, footer } = raw;
  if (
    typeof illustration !== 'string' || !illustrations.has(illustration as TemplateCard['illustration']) ||
    typeof heading !== 'string' || heading.trim().length === 0 || heading.length > 300 ||
    (message !== undefined && (typeof message !== 'string' || message.length > 500)) ||
    footer !== 'heart'
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  const fieldTypes = new Map(fields?.map((field) => [field.id, field.type]));
  for (const text of [heading, ...(typeof message === 'string' ? [message] : [])]) {
    const references = [...text.matchAll(/\{\{([^{}]+)\}\}/g)];
    const withoutReferences = text.replace(/\{\{[^{}]+\}\}/g, '');
    if (/[{}]/.test(withoutReferences)) throw new InvalidTemplateDefinitionError();
    for (const reference of references) {
      const fieldId = reference[1];
      if (typeof fieldId !== 'string' || !fieldIdPattern.test(fieldId) || (fields && !['text', 'textarea'].includes(fieldTypes.get(fieldId) ?? ''))) {
        throw new InvalidTemplateDefinitionError();
      }
    }
  }

  return {
    illustration: illustration as TemplateCard['illustration'],
    heading,
    ...(typeof message === 'string' ? { message } : {}),
    footer: 'heart',
  };
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
