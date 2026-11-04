import type { JsonObject } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError } from './errors.js';

export type TemplateCard = {
  illustration: 'wave' | 'shopping-bag-heart' | 'installment-calendar' | 'due-calendar' | 'overdue-warning' | 'pix-qr' | 'payment-check' | 'trophy' | 'service-clipboard' | 'service-seal' | 'gift' | 'product-tag' | 'offer-tag' | 'collection-bag' | 'reactivation-heart' | 'approval-hourglass';
  layout?: 'standard' | 'welcome' | 'product' | 'offer' | 'collection' | 'pix' | 'approval' | 'celebration' | 'settled';
  variables?: Record<string, string>;
  heading: string;
  highlightedText?: string;
  subtitle?: string;
  subtitlePlacement?: 'before-highlight' | 'after-highlight';
  subtitleStyle?: 'supporting' | 'subheading';
  pixNoteFieldId?: string;
  message?: string;
  details?: TemplateCardDetail[];
  product?: TemplateCardProduct;
  financial?: TemplateFinancialRule;
  action?: TemplateCardAction;
  actions?: TemplateCardAction[];
  brand?: TemplateCardBrand;
  socialLinks?: TemplateCardSocialLink[];
  footer: 'heart' | 'none';
};

export type TemplateCardDetail = {
  label?: string;
  labelFieldId?: string;
  value: string;
  valueStyle?: 'emphasis' | 'supporting';
  statusBadge?: string;
  imageFieldId?: string;
  icon?: 'package' | 'credit-card' | 'calendar' | 'check' | 'link' | 'qrcode' | 'chat' | 'badge' | 'wallet' | 'receipt' | 'heart' | 'shield' | 'gift' | 'cake' | 'sparkles' | 'shopping-bag' | 'clock' | 'clipboard-check';
  format?: 'currency' | 'date';
};

export type TemplateCardProduct = {
  nameFieldId?: string;
  descriptionFieldId?: string;
  imageFieldId?: string;
  galleryFieldIds?: string[];
  priceFieldId?: string;
  originalPriceFieldId?: string;
  icon?: 'cake' | 'calendar';
};
export type TemplateFinancialRule = { stateFieldId: string; expectedState: 'confirmed' | 'settled'; balanceFieldId?: string };
export type TemplateCardAction = { label?: string; labelFieldId?: string; hrefFieldId?: string; copyFieldId?: string };
export type TemplateCardBrand = { businessNameFieldId: string; logoFieldId?: string };
export type TemplateCardSocialLink = { platform: 'instagram' | 'whatsapp' | 'facebook' | 'tiktok' | 'youtube'; hrefFieldId: string };

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
const cardKeys = new Set(['illustration', 'layout', 'variables', 'heading', 'highlightedText', 'subtitle', 'subtitlePlacement', 'subtitleStyle', 'pixNoteFieldId', 'message', 'details', 'product', 'financial', 'action', 'actions', 'brand', 'socialLinks', 'footer']);
const fieldIdPattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const detailIcons = new Set(['package', 'credit-card', 'calendar', 'check', 'link', 'qrcode', 'chat', 'badge', 'wallet', 'receipt', 'heart', 'shield', 'gift', 'cake', 'sparkles', 'shopping-bag', 'clock', 'clipboard-check']);
const cardLayouts = new Set(['standard', 'welcome', 'product', 'offer', 'collection', 'pix', 'approval', 'celebration', 'settled']);

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

  const { illustration, layout, variables, heading, highlightedText, subtitle, subtitlePlacement, subtitleStyle, pixNoteFieldId, message, details, product, financial, action, actions, brand, socialLinks, footer } = raw;
  if (
    typeof illustration !== 'string' || !illustrations.has(illustration as TemplateCard['illustration']) ||
    (layout !== undefined && (typeof layout !== 'string' || !cardLayouts.has(layout))) ||
    typeof heading !== 'string' || heading.trim().length === 0 || heading.length > 300 ||
    (highlightedText !== undefined && (typeof highlightedText !== 'string' || highlightedText.length > 300)) ||
    (subtitle !== undefined && (typeof subtitle !== 'string' || subtitle.length > 500)) ||
    (subtitlePlacement !== undefined && subtitlePlacement !== 'before-highlight' && subtitlePlacement !== 'after-highlight') ||
    (subtitleStyle !== undefined && subtitleStyle !== 'supporting' && subtitleStyle !== 'subheading') ||
    (pixNoteFieldId !== undefined && (typeof pixNoteFieldId !== 'string' || !fieldIdPattern.test(pixNoteFieldId))) ||
    (message !== undefined && (typeof message !== 'string' || message.length > 500)) ||
    (footer !== 'heart' && footer !== 'none')
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  const fieldTypes = new Map(fields?.map((field) => [field.id, field.type]));
  const shouldValidateBindings = fields !== undefined;
  if (typeof pixNoteFieldId === 'string' && shouldValidateBindings && !['text', 'textarea'].includes(fieldTypes.get(pixNoteFieldId) ?? '')) {
    throw new InvalidTemplateDefinitionError();
  }
  for (const text of [heading, ...(typeof highlightedText === 'string' ? [highlightedText] : []), ...(typeof subtitle === 'string' ? [subtitle] : []), ...(typeof message === 'string' ? [message] : [])]) {
    validateBindings(text, fieldTypes, new Set(['text', 'textarea']), shouldValidateBindings);
  }

  const resolvedDetails = resolveDetails(details, fieldTypes, shouldValidateBindings);
  const resolvedVariables = resolveVariables(variables, fieldTypes, shouldValidateBindings);
  const resolvedProduct = resolveProduct(product, fieldTypes, shouldValidateBindings);
  const resolvedFinancial = resolveFinancial(financial, fieldTypes, shouldValidateBindings);
  const resolvedAction = resolveAction(action, fieldTypes, shouldValidateBindings);
  const resolvedActions = resolveActions(actions, fieldTypes, shouldValidateBindings);
  if (resolvedAction && resolvedActions) throw new InvalidTemplateDefinitionError();
  const resolvedBrand = resolveBrand(brand, fieldTypes, shouldValidateBindings);
  const resolvedSocialLinks = resolveSocialLinks(socialLinks, fieldTypes, shouldValidateBindings);

  return {
    illustration: illustration as TemplateCard['illustration'],
    ...(typeof layout === 'string' ? { layout: layout as NonNullable<TemplateCard['layout']> } : {}),
    ...(resolvedVariables ? { variables: resolvedVariables } : {}),
    heading,
    ...(typeof highlightedText === 'string' ? { highlightedText } : {}),
    ...(typeof subtitle === 'string' ? { subtitle } : {}),
    ...(subtitlePlacement === 'before-highlight' || subtitlePlacement === 'after-highlight' ? { subtitlePlacement } : {}),
    ...(subtitleStyle === 'supporting' || subtitleStyle === 'subheading' ? { subtitleStyle } : {}),
    ...(typeof pixNoteFieldId === 'string' ? { pixNoteFieldId } : {}),
    ...(typeof message === 'string' ? { message } : {}),
    ...(resolvedDetails ? { details: resolvedDetails } : {}),
    ...(resolvedProduct ? { product: resolvedProduct } : {}),
    ...(resolvedFinancial ? { financial: resolvedFinancial } : {}),
    ...(resolvedAction ? { action: resolvedAction } : {}),
    ...(resolvedActions ? { actions: resolvedActions } : {}),
    ...(resolvedBrand ? { brand: resolvedBrand } : {}),
    ...(resolvedSocialLinks ? { socialLinks: resolvedSocialLinks } : {}),
    footer,
  };
}

function resolveSocialLinks(
  socialLinks: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardSocialLink[] | undefined {
  if (socialLinks === undefined) return undefined;
  const socialFieldByPlatform: Record<TemplateCardSocialLink['platform'], string> = {
    instagram: 'instagramUrl',
    whatsapp: 'whatsappUrl',
    facebook: 'facebookUrl',
    tiktok: 'tiktokUrl',
    youtube: 'youtubeUrl',
  };
  const supportedPlatforms = new Set<TemplateCardSocialLink['platform']>(Object.keys(socialFieldByPlatform) as TemplateCardSocialLink['platform'][]);
  if (!Array.isArray(socialLinks) || socialLinks.length < 1 || socialLinks.length > supportedPlatforms.size) {
    throw new InvalidTemplateDefinitionError();
  }

  const platforms = new Set<string>();
  const fieldIds = new Set<string>();
  return socialLinks.map((entry) => {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !['platform', 'hrefFieldId'].includes(key))) {
      throw new InvalidTemplateDefinitionError();
    }
    const { platform, hrefFieldId } = entry;
    if (
      typeof platform !== 'string' || !supportedPlatforms.has(platform as TemplateCardSocialLink['platform']) || platforms.has(platform) ||
      typeof hrefFieldId !== 'string' || !fieldIdPattern.test(hrefFieldId) || fieldIds.has(hrefFieldId) ||
      (typeof platform === 'string' && supportedPlatforms.has(platform as TemplateCardSocialLink['platform']) && hrefFieldId !== socialFieldByPlatform[platform as TemplateCardSocialLink['platform']]) ||
      (shouldValidateBindings && fieldTypes.get(hrefFieldId) !== 'url')
    ) {
      throw new InvalidTemplateDefinitionError();
    }
    platforms.add(platform);
    fieldIds.add(hrefFieldId);
    return { platform: platform as TemplateCardSocialLink['platform'], hrefFieldId };
  });
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
    if (!isRecord(detail) || Object.keys(detail).some((key) => !['label', 'labelFieldId', 'value', 'valueStyle', 'statusBadge', 'imageFieldId', 'icon', 'format'].includes(key))) {
      throw new InvalidTemplateDefinitionError();
    }
    const { label, labelFieldId, value, valueStyle, statusBadge, imageFieldId, icon, format } = detail;
    if (
      (label !== undefined && (typeof label !== 'string' || label.trim().length === 0 || label.length > 80)) ||
      (labelFieldId !== undefined && (typeof labelFieldId !== 'string' || !fieldIdPattern.test(labelFieldId) || (shouldValidateBindings && !['text', 'textarea'].includes(fieldTypes.get(labelFieldId) ?? '')))) ||
      typeof value !== 'string' || value.length > 300 ||
      (valueStyle !== undefined && valueStyle !== 'emphasis' && valueStyle !== 'supporting') ||
      (statusBadge !== undefined && (typeof statusBadge !== 'string' || statusBadge.trim().length === 0 || statusBadge.length > 24)) ||
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
      ...(typeof label === 'string' ? { label } : {}),
      ...(typeof labelFieldId === 'string' ? { labelFieldId } : {}),
      value,
      ...(valueStyle === 'emphasis' || valueStyle === 'supporting' ? { valueStyle } : {}),
      ...(typeof statusBadge === 'string' ? { statusBadge } : {}),
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
  if (!isRecord(action) || Object.keys(action).some((key) => !['label', 'labelFieldId', 'hrefFieldId', 'copyFieldId'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const { label, labelFieldId, hrefFieldId, copyFieldId } = action;
  if (
    (label !== undefined && (typeof label !== 'string' || label.trim().length === 0 || label.length > 120)) ||
    (label === undefined && labelFieldId === undefined) ||
    (labelFieldId !== undefined && (typeof labelFieldId !== 'string' || !fieldIdPattern.test(labelFieldId) || (shouldValidateBindings && !['text', 'textarea'].includes(fieldTypes.get(labelFieldId) ?? '')))) ||
    (hrefFieldId !== undefined && (
      typeof hrefFieldId !== 'string' || !fieldIdPattern.test(hrefFieldId) ||
      (shouldValidateBindings && fieldTypes.get(hrefFieldId) !== 'url')
    )) ||
    (copyFieldId !== undefined && (
      typeof copyFieldId !== 'string' || !fieldIdPattern.test(copyFieldId) ||
      (shouldValidateBindings && !['text', 'textarea'].includes(fieldTypes.get(copyFieldId) ?? ''))
    )) ||
    (hrefFieldId !== undefined && copyFieldId !== undefined)
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  return {
    ...(typeof label === 'string' ? { label } : {}),
    ...(typeof labelFieldId === 'string' ? { labelFieldId } : {}),
    ...(typeof hrefFieldId === 'string' ? { hrefFieldId } : {}),
    ...(typeof copyFieldId === 'string' ? { copyFieldId } : {}),
  };
}

function resolveProduct(
  product: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateCardProduct | undefined {
  if (product === undefined) return undefined;
  const keys = ['nameFieldId', 'descriptionFieldId', 'imageFieldId', 'galleryFieldIds', 'priceFieldId', 'originalPriceFieldId', 'icon'];
  if (!isRecord(product) || Object.keys(product).some((key) => !keys.includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const resolved: TemplateCardProduct = {};
  if (product.icon !== undefined) {
    if (product.icon !== 'cake' && product.icon !== 'calendar') throw new InvalidTemplateDefinitionError();
    resolved.icon = product.icon;
  }
  for (const key of ['nameFieldId', 'descriptionFieldId', 'imageFieldId', 'priceFieldId', 'originalPriceFieldId'] as const) {
    const value = product[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !fieldIdPattern.test(value)) throw new InvalidTemplateDefinitionError();
    if (shouldValidateBindings) {
      const expected = key === 'imageFieldId' ? 'image' : key === 'priceFieldId' || key === 'originalPriceFieldId' ? 'number' : 'text';
      if (fieldTypes.get(value) !== expected) throw new InvalidTemplateDefinitionError();
    }
    resolved[key] = value;
  }
  if (product.galleryFieldIds !== undefined) {
    if (!Array.isArray(product.galleryFieldIds) || product.galleryFieldIds.length > 6 || product.galleryFieldIds.some((value) => typeof value !== 'string' || !fieldIdPattern.test(value) || (shouldValidateBindings && fieldTypes.get(value) !== 'image'))) {
      throw new InvalidTemplateDefinitionError();
    }
    resolved.galleryFieldIds = product.galleryFieldIds as string[];
  }
  if (Object.keys(resolved).length === 0) throw new InvalidTemplateDefinitionError();
  return resolved;
}

function resolveFinancial(
  financial: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): TemplateFinancialRule | undefined {
  if (financial === undefined) return undefined;
  if (!isRecord(financial) || Object.keys(financial).some((key) => !['stateFieldId', 'expectedState', 'balanceFieldId'].includes(key))) {
    throw new InvalidTemplateDefinitionError();
  }
  const { stateFieldId, expectedState, balanceFieldId } = financial;
  if (
    typeof stateFieldId !== 'string' || !fieldIdPattern.test(stateFieldId) ||
    (expectedState !== 'confirmed' && expectedState !== 'settled') ||
    (shouldValidateBindings && fieldTypes.get(stateFieldId) !== 'select') ||
    (balanceFieldId !== undefined && (typeof balanceFieldId !== 'string' || !fieldIdPattern.test(balanceFieldId) || (shouldValidateBindings && fieldTypes.get(balanceFieldId) !== 'number')))
  ) {
    throw new InvalidTemplateDefinitionError();
  }
  if (expectedState === 'settled' && typeof balanceFieldId !== 'string') throw new InvalidTemplateDefinitionError();
  return {
    stateFieldId,
    expectedState,
    ...(typeof balanceFieldId === 'string' ? { balanceFieldId } : {}),
  };
}

function resolveVariables(
  variables: unknown,
  fieldTypes: Map<string, string | undefined>,
  shouldValidateBindings: boolean,
): Record<string, string> | undefined {
  if (variables === undefined) return undefined;
  const allowedNames = new Set(['nome_cliente', 'nome_empresa', 'valor', 'vencimento', 'produto', 'servico', 'detalhes']);
  if (!isRecord(variables) || Object.keys(variables).some((name) => !allowedNames.has(name))) {
    throw new InvalidTemplateDefinitionError();
  }
  const resolved: Record<string, string> = {};
  for (const [name, fieldId] of Object.entries(variables)) {
    if (typeof fieldId !== 'string' || !fieldIdPattern.test(fieldId)) throw new InvalidTemplateDefinitionError();
    if (shouldValidateBindings && !['text', 'textarea', 'number', 'date'].includes(fieldTypes.get(fieldId) ?? '')) {
      throw new InvalidTemplateDefinitionError();
    }
    resolved[name] = fieldId;
  }
  return resolved;
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
