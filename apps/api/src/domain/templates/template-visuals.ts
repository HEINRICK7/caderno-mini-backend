import type { JsonObject, JsonValue } from '../shared/json-value.js';
import { InvalidTemplateDefinitionError } from './errors.js';

export type TemplateVisuals = {
  layout: 'card' | 'centered' | 'editorial' | 'minimal';
  background: string;
  surface: string;
  accent: string;
  heading: string;
  text: string;
  muted: string;
  headingFont: 'serif' | 'sans' | 'rounded';
  bodyFont: 'serif' | 'sans' | 'rounded';
  frame: 'none' | 'single' | 'double';
};

const visualKeys = new Set<keyof TemplateVisuals>([
  'layout',
  'background',
  'surface',
  'accent',
  'heading',
  'text',
  'muted',
  'headingFont',
  'bodyFont',
  'frame',
]);

const defaultVisuals: TemplateVisuals = {
  layout: 'card',
  background: '#f7f1e8',
  surface: '#ffffff',
  accent: '#8b6245',
  heading: '#30271f',
  text: '#2f2a27',
  muted: '#705a49',
  headingFont: 'sans',
  bodyFont: 'sans',
  frame: 'none',
};

const layouts = new Set<TemplateVisuals['layout']>(['card', 'centered', 'editorial', 'minimal']);
const fonts = new Set<TemplateVisuals['headingFont']>(['serif', 'sans', 'rounded']);
const frames = new Set<TemplateVisuals['frame']>(['none', 'single', 'double']);
const colorKeys = ['background', 'surface', 'accent', 'heading', 'text', 'muted'] as const;

export function resolveTemplateVisuals(definition: JsonObject): TemplateVisuals {
  const raw = definition.visual;
  if (raw === undefined) {
    return defaultVisuals;
  }
  if (!isRecord(raw) || Object.keys(raw).length !== visualKeys.size) {
    throw new InvalidTemplateDefinitionError();
  }
  if (Object.keys(raw).some((key) => !visualKeys.has(key as keyof TemplateVisuals))) {
    throw new InvalidTemplateDefinitionError();
  }

  const layout = raw.layout;
  const headingFont = raw.headingFont;
  const bodyFont = raw.bodyFont;
  const frame = raw.frame;
  if (
    typeof layout !== 'string' ||
    !layouts.has(layout as TemplateVisuals['layout']) ||
    typeof headingFont !== 'string' ||
    !fonts.has(headingFont as TemplateVisuals['headingFont']) ||
    typeof bodyFont !== 'string' ||
    !fonts.has(bodyFont as TemplateVisuals['bodyFont']) ||
    typeof frame !== 'string' ||
    !frames.has(frame as TemplateVisuals['frame']) ||
    colorKeys.some((key) => typeof raw[key] !== 'string' || !/^#[\da-fA-F]{6}$/.test(raw[key] as string))
  ) {
    throw new InvalidTemplateDefinitionError();
  }

  return {
    layout: layout as TemplateVisuals['layout'],
    background: raw.background as string,
    surface: raw.surface as string,
    accent: raw.accent as string,
    heading: raw.heading as string,
    text: raw.text as string,
    muted: raw.muted as string,
    headingFont: headingFont as TemplateVisuals['headingFont'],
    bodyFont: bodyFont as TemplateVisuals['bodyFont'],
    frame: frame as TemplateVisuals['frame'],
  };
}

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
