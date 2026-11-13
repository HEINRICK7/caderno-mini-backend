import type { JsonObject } from '../shared/json-value.js';

export function resolveTemplateBusinessName(definition: JsonObject | null | undefined, data: JsonObject): string {
  const card = asObject(definition?.card);
  const brand = asObject(card?.brand);
  const variables = asObject(card?.variables);
  const fieldId = typeof brand?.businessNameFieldId === 'string'
    ? brand.businessNameFieldId
    : typeof variables?.nome_empresa === 'string'
      ? variables.nome_empresa
      : 'businessName';
  const value = data[fieldId];
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
