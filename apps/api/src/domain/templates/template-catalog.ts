import type { JsonObject, JsonValue } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError } from './errors.js';

export const templateSegments = ['product', 'service', 'both'] as const;
export const templateCategories = [
  'Agradecimento',
  'Boas-vindas',
  'Datas especiais',
  'Cobrança',
  'Entrega',
  'Promoções',
] as const;
export const templateHomeCategories = ['relacionamento', 'cobrancas', 'ofertas', 'servicos'] as const;

export type TemplateSegment = typeof templateSegments[number];
export type TemplateCategory = typeof templateCategories[number];
export type TemplateHomeCategory = typeof templateHomeCategories[number];
export type TemplateCatalog = {
  segment: TemplateSegment;
  category: TemplateCategory;
  homeCategory?: TemplateHomeCategory;
};

const allowedKeys = new Set(['segment', 'category', 'homeCategory']);

export function resolveTemplateCatalog(definition: JsonObject): TemplateCatalog | undefined {
  const raw = definition.catalog;
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    throw new InvalidTemplateDefinitionError();
  }

  const { segment, category } = raw;
  const homeCategory = raw.homeCategory;
  if (
    typeof segment !== 'string' || !templateSegments.includes(segment as TemplateSegment) ||
    typeof category !== 'string' || !templateCategories.includes(category as TemplateCategory) ||
    (homeCategory !== undefined && (typeof homeCategory !== 'string' || !templateHomeCategories.includes(homeCategory as TemplateHomeCategory)))
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  return {
    segment: segment as TemplateSegment,
    category: category as TemplateCategory,
    ...(homeCategory ? { homeCategory: homeCategory as TemplateHomeCategory } : {}),
  };
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
