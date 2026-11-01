import type { JsonObject } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError } from './errors.js';

export type TemplateCard = {
  illustration: 'wave' | 'shopping-bag-heart' | 'installment-calendar' | 'due-calendar' | 'overdue-warning' | 'pix-qr' | 'payment-check' | 'trophy' | 'service-clipboard' | 'service-seal' | 'gift' | 'product-tag' | 'offer-tag' | 'collection-bag' | 'reactivation-heart' | 'approval-hourglass';
  heading: string;
  message?: string;
  details?: TemplateCardDetail[];
  action?: TemplateCardAction;
  actions?: TemplateCardAction[];
  brand?: TemplateCardBrand;
  footer: 'heart' | 'none';
};

export type TemplateCardDetail = {
  label: string;
  value: string;
  imageFieldId?: string;
  icon?: 'package' | 'credit-card' | 'calendar' | 'check' | 'link' | 'qrcode';
  format?: 'currency' | 'date';
};

export type TemplateCardAction = { label: string; hrefFieldId?: string };
export type TemplateCardBrand = { businessNameFieldId: string; logoFieldId?: string };

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
const cardKeys = new Set(['illustration', 'heading', 'message', 'details', 'action', 'actions', 'brand', 'footer']);
const fieldIdPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const detailIcons = new Set(['package', 'credit-card', 'calendar', 'check', 'link', 'qrcode']);

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

  const { illustration, heading, message, details, action, actions, brand, footer } = raw;
  if (
    typeof illustration !== 'string' || !illustrations.has(illustration as TemplateCard['illustration']) ||
    typeof heading !== 'string' || heading.trim().length === 0 || heading.length > 300 ||
    (message !== undefined && (typeof message !== 'string' || message.length > 500)) ||
    (footer !== 'heart' && footer !== 'none')
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  const fieldTypes = new Map(fields?.map((field) => [field.id, field.type]));
  const shouldValidateBindings = fields !== undefined;
  for (const text of [heading, ...(typeof message === 'string' ? [message] : [])]) {
    validateBindings(text, fieldTypes, new Set(['text', 'textarea']), shouldValidateBindings);
  }

  const resolvedDetails = resolveDetails(details, fieldTypes, shouldValidateBindings);
  const resolvedAction = resolveAction(action, fieldTypes, shouldValidateBindings);
  const resolvedActions = resolveActions(actions, fieldTypes, shouldValidateBindings);
  if (resolvedAction && resolvedActions) throw new InvalidTemplateDefinitionError();
  const resolvedBrand = resolveBrand(brand, fieldTypes, shouldValidateBindings);

  return {
    illustration: illustration as TemplateCard['illustration'],
    heading,
    ...(typeof message === 'string' ? { message } : {}),
    ...(resolvedDetails ? { details: resolvedDetails } : {}),
    ...(resolvedAction ? { action: resolvedAction } : {}),
    ...(resolvedActions ? { actions: resolvedActions } : {}),
    ...(resolvedBrand ? { brand: resolvedBrand } : {}),
    footer,
  };
}

function resolveBrand(
  brand: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardBrand | undefined {
  if (brand === undefined) return undefined;
  if (!isRecord(brand) || Object.keys(brand).some((key) => !['businessNameFieldId', 'logoFieldId'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const { businessNameFieldId, logoFieldId } = brand;
  if (
    typeof businessNameFieldId !== 'string' || !fieldIdPattern.test(businessNameFieldId) ||
    (shouldValidateBindings && !['text', 'textarea'].includes(fieldTypes.get(businessNameFieldId) ?? '')) ||
    (logoFieldId !== undefined && (
      typeof logoFieldId !== 'string' || !fieldIdPattern.test(logoFieldId) ||
      (shouldValidateBindings && fieldTypes.get(logoFieldId) !== 'image')
    ))
  ) {
    throw new InvalidTemplateDefinitionError();
  }
  return {
    businessNameFieldId,
    ...(typeof logoFieldId === 'string' ? { logoFieldId } : {}),
  };
}

function resolveDetails(
  details: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardDetail[] | undefined {
  if (details === undefined) return undefined;
  if (!Array.isArray(details) || details.length < 1 || details.length > 6) {
    throw new InvalidTemplateDefinitionError();
  }

  return details.map((detail) => {
    if (!isRecord(detail) || Object.keys(detail).some((key) => !['label', 'value', 'imageFieldId', 'icon', 'format'].includes(key))) {
      throw new InvalidTemplateDefinitionError();
    }
    const { label, value, imageFieldId, icon, format } = detail;
    if (
      typeof label !== 'string' || label.trim().length === 0 || label.length > 80 ||
      typeof value !== 'string' || value.length > 300 ||
      (imageFieldId !== undefined && (
        typeof imageFieldId !== 'string' || !fieldIdPattern.test(imageFieldId) ||
        (shouldValidateBindings && fieldTypes.get(imageFieldId) !== 'image')
      )) ||
      (icon !== undefined && (typeof icon !== 'string' || !detailIcons.has(icon))) ||
      (format !== undefined && format !== 'currency' && format !== 'date')
    ) {
      throw new InvalidTemplateDefinitionError();
    }
    const references = validateBindings(
      value,
      fieldTypes,
      new Set(['text', 'textarea', 'number', 'select', 'date']),
      shouldValidateBindings,
    );
    if (format === 'currency' && shouldValidateBindings && references.some((fieldId) => fieldTypes.get(fieldId) !== 'number')) {
      throw new InvalidTemplateDefinitionError();
    }
    if (format === 'date' && shouldValidateBindings && references.some((fieldId) => fieldTypes.get(fieldId) !== 'date')) {
      throw new InvalidTemplateDefinitionError();
    }
    return {
      label,
      value,
      ...(typeof imageFieldId === 'string' ? { imageFieldId } : {}),
      ...(typeof icon === 'string' ? { icon: icon as NonNullable<TemplateCardDetail['icon']> } : {}),
      ...(format === 'currency' || format === 'date' ? { format } : {}),
    };
  });
}

function resolveAction(
  action: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardAction | undefined {
  if (action === undefined) return undefined;
  if (!isRecord(action) || Object.keys(action).some((key) => !['label', 'hrefFieldId'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const { label, hrefFieldId } = action;
  if (
    typeof label !== 'string' || label.trim().length === 0 || label.length > 120 ||
    (hrefFieldId !== undefined && (
      typeof hrefFieldId !== 'string' || !fieldIdPattern.test(hrefFieldId) ||
      (shouldValidateBindings && fieldTypes.get(hrefFieldId) !== 'url')
    ))
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  return {
    label,
    ...(typeof hrefFieldId === 'string' ? { hrefFieldId } : {}),
  };
}

function resolveActions(
  actions: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardAction[] | undefined {
  if (actions === undefined) return undefined;
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 3) {
    throw new InvalidTemplateDefinitionError();
  }
  return actions.map((action) => {
    const resolved = resolveAction(action, fieldTypes, shouldValidateBindings);
    if (!resolved) throw new InvalidTemplateDefinitionError();
    return resolved;
  });
}

function validateBindings(
  text: string,
  fieldTypes: Map<string, string | undefined>,
  allowedTypes: Set<string>,
  shouldValidateBindings: boolean,
): string[] {
  const references = [...text.matchAll(/\{\{([^{}]+)\}\}/g)];
  const withoutReferences = text.replace(/\{\{[^{}]+\}\}/g, '');
  if (/[{}]/.test(withoutReferences)) throw new InvalidTemplateDefinitionError();
  const fieldIds: string[] = [];
  for (const reference of references) {
    const fieldId = reference[1];
    if (
      typeof fieldId !== 'string' || !fieldIdPattern.test(fieldId) ||
      (shouldValidateBindings && !allowedTypes.has(fieldTypes.get(fieldId) ?? ''))
    ) {
      throw new InvalidTemplateDefinitionError();
    }
    fieldIds.push(fieldId);
  }
  return fieldIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
