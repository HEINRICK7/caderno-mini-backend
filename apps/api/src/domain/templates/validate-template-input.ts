import type { JsonObject, JsonValue } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError, TemplateInputValidationError } from './errors.js';
import type { TemplateValidationIssue } from './errors.js';
import { validateTemplateCard } from './template-card.js';
import { resolveTemplateVisuals } from './template-visuals.js';
import { resolveTemplateCatalog } from './template-catalog.js';

type SupportedFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'url' | 'color' | 'date';

type TemplateField = {
  id: string;
  type: SupportedFieldType;
  label?: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
  maxLength?: number;
  options?: string[];
};

const supportedFieldTypes = new Set<SupportedFieldType>([
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'url',
  'color',
  'date',
]);

export function validateTemplateInput(definition: JsonObject, data: JsonObject): void {
  const fields = parseFields(definition);
  const issues: TemplateValidationIssue[] = [];
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  for (const key of Object.keys(data)) {
    if (!fieldsById.has(key)) {
      issues.push({ path: key, code: 'unknown_field', message: 'Este campo não existe no modelo.' });
    }
  }

  for (const field of fields) {
    const value = data[field.id];
    if (value === undefined) {
      if (field.required) {
        issues.push({ path: field.id, code: 'required', message: 'Este campo é obrigatório.' });
      }
      continue;
    }

    const issue = validateValue(field, value);
    if (issue) {
      issues.push({ path: field.id, code: issue, message: issueMessage(issue) });
    }
  }

  if (issues.length > 0) {
    throw new TemplateInputValidationError(issues);
  }
}

export function validateTemplateDefinition(definition: JsonObject): void {
  if (Object.keys(definition).some((key) => !['fields', 'visual', 'card', 'catalog'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const fields = parseFields(definition);
  validateTemplateCard(definition, fields);
  resolveTemplateVisuals(definition);
  resolveTemplateCatalog(definition);
}

function parseFields(definition: JsonObject): TemplateField[] {
  const rawFields = definition.fields;
  if (!Array.isArray(rawFields) || rawFields.length > 100) {
    throw new InvalidTemplateDefinitionError();
  }

  const fields: TemplateField[] = [];
  const ids = new Set<string>();
  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      throw new InvalidTemplateDefinitionError();
    }
    const { id, type, label, placeholder, helpText, required, maxLength, options } = rawField;
    if (
      Object.keys(rawField).some((key) => !['id', 'type', 'label', 'placeholder', 'helpText', 'required', 'maxLength', 'options'].includes(key)) ||
      typeof id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) ||
      typeof type !== 'string' ||
      !supportedFieldTypes.has(type as SupportedFieldType) ||
      (label !== undefined && (typeof label !== 'string' || label.trim().length === 0 || label.length > 120)) ||
      (placeholder !== undefined && (typeof placeholder !== 'string' || placeholder.length > 200)) ||
      (helpText !== undefined && (typeof helpText !== 'string' || helpText.length > 500)) ||
      (required !== undefined && typeof required !== 'boolean') ||
      (maxLength !== undefined && (!Number.isInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > 20_000)) ||
      (options !== undefined && (!Array.isArray(options) || options.some((option) => typeof option !== 'string' || option.length === 0 || option.length > 120)))
    ) {
      throw new InvalidTemplateDefinitionError();
    }
    if ((type === 'select' && (!Array.isArray(options) || options.length === 0)) || (type !== 'select' && options !== undefined)) {
      throw new InvalidTemplateDefinitionError();
    }
    if (ids.has(id)) {
      throw new InvalidTemplateDefinitionError();
    }
    ids.add(id);
    fields.push({
      id,
      type: type as SupportedFieldType,
      ...(typeof label === 'string' ? { label } : {}),
      ...(typeof placeholder === 'string' ? { placeholder } : {}),
      ...(typeof helpText === 'string' ? { helpText } : {}),
      ...(typeof required === 'boolean' ? { required } : {}),
      ...(typeof maxLength === 'number' ? { maxLength } : {}),
      ...(Array.isArray(options) ? { options: options as string[] } : {}),
    });
  }
  return fields;
}

function validateValue(field: TemplateField, value: JsonValue): string | undefined {
  if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string') {
    if (field.required && value.trim().length === 0) {
      return 'required';
    }
    return value.length <= (field.maxLength ?? 10_000) ? undefined : 'too_long';
  }
  if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return undefined;
  }
  if (field.type === 'boolean' && typeof value === 'boolean') {
    return undefined;
  }
  if (field.type === 'select' && typeof value === 'string' && field.options?.includes(value)) {
    return undefined;
  }
  if (field.type === 'url' && typeof value === 'string' && value.length <= (field.maxLength ?? 2_048)) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? undefined : 'invalid_url';
    } catch {
      return 'invalid_url';
    }
  }
  if (field.type === 'color' && typeof value === 'string' && /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/.test(value)) {
    return undefined;
  }
  if (field.type === 'date' && typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return undefined;
  }
  return 'invalid_type';
}

function issueMessage(code: string): string {
  if (code === 'too_long') return 'O valor ultrapassa o limite de caracteres.';
  if (code === 'invalid_url') return 'Informe uma URL HTTP ou HTTPS válida.';
  if (code === 'required') return 'Este campo é obrigatório.';
  return 'O valor não corresponde ao tipo deste campo.';
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
