import type { JsonObject, JsonValue } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError, TemplateInputValidationError } from './errors.js';
import type { TemplateValidationIssue } from './errors.js';
import { validateTemplateCard } from './template-card.js';
import { resolveTemplateVisuals } from './template-visuals.js';
import { resolveTemplateCatalog } from './template-catalog.js';
import { MAX_IMAGE_BYTES } from '../images/image-limits.js';

type SupportedFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'url' | 'color' | 'date' | 'image';

type TemplateField = {
  id: string;
  type: SupportedFieldType;
  label?: string;
  placeholder?: string;
  helpText?: string;
  section?: string;
  width?: 'half' | 'full';
  format?: 'currency';
  required?: boolean;
  editable?: boolean;
  maxLength?: number;
  maxBytes?: number;
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
  'image',
]);

export function validateTemplateInput(
  definition: JsonObject,
  data: JsonObject,
  options: { allowSystemFields?: boolean } = {},
): void {
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
    if (field.editable === false && !options.allowSystemFields) {
      if (value !== undefined) {
        issues.push({ path: field.id, code: 'not_editable', message: 'Este valor é fornecido pelo estado confiável da aplicação.' });
      }
      continue;
    }
    if (value === undefined) {
      if (field.required) {
        issues.push({ path: field.id, code: 'required', message: 'Este campo é obrigatório.' });
      }
      continue;
    }

    const validationIssue = validateValue(field, value);
    const issue = validationIssue ?? (
      field.id === 'pixCopyPaste' && typeof value === 'string' && value.length > 0 && !isValidPixCopyPaste(value)
        ? 'invalid_pix_payload'
        : socialPlatformForField(field.id) && typeof value === 'string' && value.trim().length > 0 && !isValidSocialLink(field.id, value)
          ? 'invalid_social_link'
        : undefined
    );
    if (issue) {
      issues.push({ path: field.id, code: issue, message: issueMessage(issue) });
    }
  }

  if (fieldsById.has('oldPrice') && fieldsById.has('newPrice') && !options.allowSystemFields) {
    const originalPrice = data.oldPrice;
    const finalPrice = data.newPrice;
    if ((originalPrice === undefined) !== (finalPrice === undefined)) {
      issues.push({ path: 'newPrice', code: 'discount_pair_required', message: 'Informe o preço original e o preço final juntos.' });
    } else if (typeof originalPrice === 'number' && typeof finalPrice === 'number' && (originalPrice <= 0 || finalPrice < 0 || finalPrice >= originalPrice)) {
      issues.push({ path: 'newPrice', code: 'invalid_discount', message: 'O preço final precisa ser menor que o preço original.' });
    }
  }

  if (issues.length > 0) {
    throw new TemplateInputValidationError(issues);
  }
}

export function validateTemplateDefinition(definition: JsonObject): void {
  if (Object.keys(definition).some((key) => !['fields', 'visual', 'card', 'catalog', 'exampleData'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const fields = parseFields(definition);
  if (definition.exampleData !== undefined) {
    if (!isRecord(definition.exampleData)) throw new InvalidTemplateDefinitionError();
    try {
      validateTemplateInput(definition, definition.exampleData, { allowSystemFields: true });
      const editableExampleData = Object.fromEntries(
        Object.entries(definition.exampleData).filter(([fieldId]) => fields.find((field) => field.id === fieldId)?.editable !== false),
      );
      validateTemplateInput(definition, editableExampleData);
    } catch {
      throw new InvalidTemplateDefinitionError();
    }
  }
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
    const { id, type, label, placeholder, helpText, section, width, format, required, editable, maxLength, maxBytes, options } = rawField;
    if (
      Object.keys(rawField).some((key) => !['id', 'type', 'label', 'placeholder', 'helpText', 'section', 'width', 'format', 'required', 'editable', 'maxLength', 'maxBytes', 'options'].includes(key)) ||
      typeof id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id) ||
      typeof type !== 'string' ||
      !supportedFieldTypes.has(type as SupportedFieldType) ||
      (label !== undefined && (typeof label !== 'string' || label.trim().length === 0 || label.length > 120)) ||
      (placeholder !== undefined && (typeof placeholder !== 'string' || placeholder.length > 200)) ||
      (helpText !== undefined && (typeof helpText !== 'string' || helpText.length > 500)) ||
      (section !== undefined && (typeof section !== 'string' || section.trim().length === 0 || section.length > 80)) ||
      (width !== undefined && width !== 'half' && width !== 'full') ||
      (format !== undefined && (format !== 'currency' || type !== 'number')) ||
      (required !== undefined && typeof required !== 'boolean') ||
      (editable !== undefined && typeof editable !== 'boolean') ||
      (maxLength !== undefined && (!Number.isInteger(maxLength) || (maxLength as number) < 1 || (maxLength as number) > 20_000)) ||
      (maxBytes !== undefined && (!Number.isInteger(maxBytes) || (maxBytes as number) < 1 || (maxBytes as number) > MAX_IMAGE_BYTES || type !== 'image')) ||
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
      ...(typeof section === 'string' ? { section } : {}),
      ...(width === 'half' || width === 'full' ? { width } : {}),
      ...(format === 'currency' ? { format } : {}),
      ...(typeof required === 'boolean' ? { required } : {}),
      ...(typeof editable === 'boolean' ? { editable } : {}),
      ...(typeof maxLength === 'number' ? { maxLength } : {}),
      ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
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
    if (field.id === 'installmentNumber' || field.id === 'installmentTotal') {
      return Number.isInteger(value) && value > 0 ? undefined : 'invalid_installment';
    }
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
  if (field.type === 'image') {
    return typeof value === 'string' && isStoredImageId(value) ? undefined : 'invalid_image';
  }
  return 'invalid_type';
}

function isStoredImageId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isValidPixCopyPaste(value: string): boolean {
  const encoded = new TextEncoder().encode(value);
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    encoded.length > 2_048 ||
    value !== value.trim() ||
    hasControlCharacter ||
    !value.startsWith('000201') ||
    !value.toLowerCase().includes('br.gov.bcb.pix') ||
    value.slice(-8, -4) !== '6304'
  ) {
    return false;
  }

  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value.slice(0, -4))) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0') === value.slice(-4).toUpperCase();
}

function socialPlatformForField(fieldId: string): string | undefined {
  return {
    instagramUrl: 'Instagram',
    whatsappUrl: 'WhatsApp',
    facebookUrl: 'Facebook',
    tiktokUrl: 'TikTok',
    youtubeUrl: 'YouTube',
  }[fieldId];
}

function isValidSocialLink(fieldId: string, value: string): boolean {
  const allowedHosts: Record<string, string[]> = {
    instagramUrl: ['instagram.com'],
    whatsappUrl: ['wa.me', 'whatsapp.com', 'api.whatsapp.com'],
    facebookUrl: ['facebook.com', 'm.facebook.com', 'fb.com'],
    tiktokUrl: ['tiktok.com', 'vm.tiktok.com'],
    youtubeUrl: ['youtube.com', 'youtu.be'],
  };
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.protocol === 'https:' && url.username === '' && url.password === '' && (allowedHosts[fieldId]?.includes(host) ?? false);
  } catch {
    return false;
  }
}

function issueMessage(code: string): string {
  if (code === 'too_long') return 'O valor ultrapassa o limite de caracteres.';
  if (code === 'invalid_installment') return 'Informe um número inteiro maior que zero para as parcelas.';
  if (code === 'invalid_url') return 'Informe uma URL HTTP ou HTTPS válida.';
  if (code === 'invalid_pix_payload') return 'Cole o código Pix completo, sem espaços extras. Confira se foi copiado diretamente do app do banco.';
  if (code === 'invalid_social_link') return 'Cole um link HTTPS válido do canal social correspondente.';
  if (code === 'required') return 'Este campo é obrigatório.';
  if (code === 'not_editable') return 'Este valor é fornecido pelo estado confiável da aplicação.';
  if (code === 'discount_pair_required') return 'Informe o preço original e o preço final juntos.';
  if (code === 'invalid_discount') return 'O preço final precisa ser menor que o preço original.';
  if (code === 'invalid_image') return 'Envie uma logo armazenada pelo serviço de imagens.';
  return 'O valor não corresponde ao tipo deste campo.';
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
