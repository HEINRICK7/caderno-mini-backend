import type { JsonObject } from '../shared/json-value.js';

const shareVariableNames = ['nome_cliente', 'nome_empresa', 'valor', 'vencimento', 'produto', 'servico'] as const;
export type TemplateShareVariables = {
  nome_cliente?: string;
  nome_empresa?: string;
  valor?: string | number;
  vencimento?: string;
  produto?: string;
  servico?: string;
};

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

export function resolveTemplateShareVariables(definition: JsonObject | null | undefined, data: JsonObject): TemplateShareVariables {
  const card = asObject(definition?.card);
  const brand = asObject(card?.brand);
  const configured = asObject(card?.variables);
  const variables: TemplateShareVariables = {};

  for (const name of shareVariableNames) {
    const fieldId = name === 'nome_empresa' && typeof brand?.businessNameFieldId === 'string'
      ? brand.businessNameFieldId
      : configured?.[name];
    if (typeof fieldId !== 'string') continue;
    const value = data[fieldId];
    if (typeof value === 'string' && value.trim()) variables[name] = value.trim();
    else if (name === 'valor' && typeof value === 'number' && Number.isFinite(value)) variables[name] = value;
  }

  return variables;
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}
