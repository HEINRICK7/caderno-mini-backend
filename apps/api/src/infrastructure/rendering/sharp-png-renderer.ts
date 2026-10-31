import sharp from 'sharp';
import { resolve } from 'node:path';

import type { PngRenderer } from '../../application/ports/png-renderer.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import type { Template } from '../../domain/templates/template.js';
import { resolveTemplateCard } from '../../domain/templates/template-card.js';
import { resolveTemplateVisuals, type TemplateVisuals } from '../../domain/templates/template-visuals.js';
import { ExportContentTooLargeError } from '../../application/errors.js';

const WIDTH = 1_080;
const MAX_FIELDS = 40;
const MAX_SVG_LENGTH = 140_000;
const STATUS_SPRITE_PATH = resolve(process.cwd(), 'apps/api/assets/status-icons-3d.png');
const STATUS_ICON_POSITION = {
  wave: [0, 0],
  'shopping-bag-heart': [1, 0],
  'installment-calendar': [2, 0],
  'due-calendar': [3, 0],
  'overdue-warning': [0, 1],
  'pix-qr': [1, 1],
  'payment-check': [2, 1],
  trophy: [3, 1],
  'service-clipboard': [0, 2],
  'service-seal': [1, 2],
  gift: [2, 2],
  'product-tag': [3, 2],
  'offer-tag': [0, 3],
  'collection-bag': [1, 3],
  'reactivation-heart': [2, 3],
  'approval-hourglass': [3, 3],
} as const;

export class SharpPngRenderer implements PngRenderer {
  async render(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data);
    return renderTemplatePng(svg, template);
  }

  async renderPreview(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data, { watermark: true });
    const rendered = await renderTemplatePng(svg, template);
    return sharp(rendered)
      .resize({ width: 540, height: 10_000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  }
}

async function renderTemplatePng(svg: string, template: Template): Promise<Buffer> {
  const card = resolveTemplateCard(template.definition);
  const renderer = sharp(Buffer.from(svg));
  if (!card) return renderer.png().toBuffer();

  const [column, row] = STATUS_ICON_POSITION[card.illustration];
  const icon = await sharp(STATUS_SPRITE_PATH)
    .extract({ left: column * 384, top: row * 256, width: 384, height: 256 })
    .png()
    .toBuffer();

  return renderer
    .composite([{ input: icon, left: 348, top: 132 }])
    .png()
    .toBuffer();
}

function renderSvg(template: Template, data: JsonObject, options: { watermark?: boolean } = {}): string {
  const visuals = resolveTemplateVisuals(template.definition);
  const card = resolveTemplateCard(template.definition);
  if (card) return renderTemplateCardSvg(template, data, card, visuals, options);

  const fields = Array.isArray(template.definition.fields) ? template.definition.fields : [];
  const labels = new Map<string, string>();
  for (const field of fields) {
    if (
      typeof field === 'object' &&
      field !== null &&
      !Array.isArray(field) &&
      typeof field.id === 'string'
    ) {
      labels.set(field.id, typeof field.label === 'string' ? field.label.slice(0, 120) : field.id);
    }
  }

  const entries = Object.entries(data).filter(([, value]) => value !== '');
  if (entries.length > MAX_FIELDS) {
    throw new ExportContentTooLargeError();
  }

  let y = 220;
  const content = entries.map(([key, value], index) => {
    const label = escapeXml(labels.get(key) ?? key);
    const lines = wrapText(asText(value), 31);
    if (lines.length > 300) {
      throw new ExportContentTooLargeError();
    }
    const height = 68 + lines.length * 54;
    const labelY = y + 48;
    const centered = visuals.layout === 'centered';
    const textX = centered ? WIDTH / 2 : visuals.layout === 'editorial' ? 112 : 104;
    const anchor = centered ? 'middle' : 'start';
    const card = visuals.layout === 'card' || centered
      ? `<rect x="64" y="${y}" width="952" height="${height}" rx="24" fill="${visuals.surface}"/>`
      : '';
    const ornament = visuals.layout === 'editorial'
      ? `<rect x="64" y="${y + 12}" width="8" height="${height - 24}" rx="4" fill="${visuals.accent}"/>`
      : visuals.layout === 'minimal' && index > 0
        ? `<line x1="64" y1="${y}" x2="1016" y2="${y}" stroke="${visuals.accent}" stroke-opacity=".3" stroke-width="2"/>`
        : '';
    const valueLines = lines
      .map((line, lineIndex) => `<text x="${textX}" y="${labelY + 56 + lineIndex * 50}" text-anchor="${anchor}" class="value">${escapeXml(line)}</text>`)
      .join('');
    const result = `${card}${ornament}<text x="${textX}" y="${labelY}" text-anchor="${anchor}" class="label">${label}</text>${valueLines}`;
    y += height + 24;
    return result;
  });

  const height = Math.max(1_350, y + 90);
  const watermarkY = Math.floor(height / 2);
  const watermark = options.watermark
    ? `<text x="${WIDTH / 2}" y="${watermarkY}" transform="rotate(-24 ${WIDTH / 2} ${watermarkY})" text-anchor="middle" class="watermark">PRÉVIA · CADERNÔ</text>`
    : '';
  const frame = renderFrame(visuals, height);
  const headingFont = fontFamily(visuals.headingFont);
  const bodyFont = fontFamily(visuals.bodyFont);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><rect width="100%" height="100%" fill="${visuals.background}"/><text x="64" y="112" class="brand">Cadernô</text><text x="64" y="172" class="title">${escapeXml(template.name.slice(0, 120))}</text>${content.join('')}${watermark}${frame}<style>.brand{font:600 28px ${headingFont};fill:${visuals.accent}}.title{font:700 42px ${headingFont};fill:${visuals.heading}}.label{font:600 26px ${bodyFont};fill:${visuals.muted}}.value{font:400 34px ${bodyFont};fill:${visuals.text}}.watermark{font:700 82px ${headingFont};fill:${visuals.accent};fill-opacity:.36;stroke:${visuals.background};stroke-opacity:.32;stroke-width:2}</style></svg>`;
  if (svg.length > MAX_SVG_LENGTH || height > 20_000) {
    throw new ExportContentTooLargeError();
  }
  return svg;
}

function renderTemplateCardSvg(
  template: Template,
  data: JsonObject,
  card: NonNullable<ReturnType<typeof resolveTemplateCard>>,
  visuals: TemplateVisuals,
  options: { watermark?: boolean },
): string {
  const fields = Array.isArray(template.definition.fields) ? template.definition.fields : [];
  const heading = interpolateCardText(card.heading, fields, data);
  const message = card.message ? interpolateCardText(card.message, fields, data) : '';
  const headingLines = wrapText(heading, 22);
  const messageLines = message ? wrapText(message, 34) : [];
  const textX = visuals.layout === 'editorial' ? 150 : 540;
  const textAnchor = visuals.layout === 'editorial' ? 'start' : 'middle';
  const headingMarkup = headingLines
    .map((line, index) => `<text x="${textX}" y="${940 + index * 74}" text-anchor="${textAnchor}" class="card-title">${escapeXml(line)}</text>`)
    .join('');
  const messageStart = 954 + headingLines.length * 74;
  const messageMarkup = messageLines
    .map((line, index) => `<text x="${textX}" y="${messageStart + 48 + index * 48}" text-anchor="${textAnchor}" class="card-message">${escapeXml(line)}</text>`)
    .join('');
  const heartY = messageLines.length > 0 ? messageStart + messageLines.length * 48 + 78 : messageStart + 42;
  const watermarkY = 675;
  const watermark = options.watermark
    ? `<text x="540" y="${watermarkY}" transform="rotate(-18 540 ${watermarkY})" text-anchor="middle" class="watermark">PRÉVIA · CADERNÔ</text>`
    : '';
  const frame = renderFrame(visuals, 1_350);
  const font = fontFamily(visuals.headingFont);
  const bodyFont = fontFamily(visuals.bodyFont);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><clipPath id="card-clip"><rect x="36" y="36" width="1008" height="1278" rx="72"/></clipPath></defs><rect width="100%" height="100%" fill="${visuals.background}"/><g clip-path="url(#card-clip)"><rect x="36" y="36" width="1008" height="770" fill="${visuals.background}"/><rect x="36" y="806" width="1008" height="508" fill="${visuals.surface}"/></g>${headingMarkup}${messageMarkup}<text x="${visuals.layout === 'editorial' ? 520 : 540}" y="${heartY}" text-anchor="middle" class="card-heart">♡</text>${watermark}${frame}<style>.card-title{font:800 62px ${font};fill:${visuals.heading}}.card-message{font:400 38px ${bodyFont};fill:${visuals.text}}.card-heart{font:700 68px Arial,sans-serif;fill:${visuals.accent}}.watermark{font:700 82px ${font};fill:${visuals.accent};fill-opacity:.5;stroke:${visuals.background};stroke-opacity:.4;stroke-width:2}</style></svg>`;
  if (svg.length > MAX_SVG_LENGTH) throw new ExportContentTooLargeError();
  return svg;
}

function interpolateCardText(template: string, fields: unknown[], data: JsonObject): string {
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g, (_match, fieldId: string) => {
    const value = data[fieldId];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    const field = fields.find((candidate) =>
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
      'id' in candidate && candidate.id === fieldId,
    );
    if (typeof field === 'object' && field !== null && !Array.isArray(field) && 'placeholder' in field && typeof field.placeholder === 'string') {
      return field.placeholder;
    }
    return '';
  });
}

function renderFrame(visuals: TemplateVisuals, height: number): string {
  if (visuals.frame === 'none') {
    return '';
  }
  if (visuals.frame === 'single') {
    return `<rect x="22" y="22" width="${WIDTH - 44}" height="${height - 44}" rx="32" fill="none" stroke="${visuals.accent}" stroke-width="4"/>`;
  }
  return `<rect x="22" y="22" width="${WIDTH - 44}" height="${height - 44}" rx="32" fill="none" stroke="${visuals.accent}" stroke-width="3"/><rect x="38" y="38" width="${WIDTH - 76}" height="${height - 76}" rx="24" fill="none" stroke="${visuals.accent}" stroke-opacity=".65" stroke-width="2"/>`;
}

function fontFamily(font: TemplateVisuals['headingFont']): string {
  const families = {
    serif: 'Georgia,serif',
    sans: 'Arial,sans-serif',
    rounded: 'Trebuchet MS,sans-serif',
  } as const;
  return families[font];
}

function asText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f
      ? '�'
      : character;
  }).join('');
}

function wrapText(value: string, lineLength: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      if (word.length > lineLength) {
        if (line) lines.push(line);
        line = '';
        const chars = Array.from(word);
        for (let index = 0; index < chars.length; index += lineLength) {
          lines.push(chars.slice(index, index + lineLength).join(''));
        }
      } else if (line.length === 0) {
        line = word;
      } else if (line.length + word.length + 1 <= lineLength) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length > 0 ? lines : [''];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
