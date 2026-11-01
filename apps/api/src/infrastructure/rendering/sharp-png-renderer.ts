import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { resolve } from 'node:path';

import type { PngRenderer } from '../../application/ports/png-renderer.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import type { Template } from '../../domain/templates/template.js';
import { resolveTemplateCard } from '../../domain/templates/template-card.js';
import { resolveTemplateVisuals, type TemplateVisuals } from '../../domain/templates/template-visuals.js';
import { ExportContentTooLargeError } from '../../application/errors.js';
import type { ImageStorage } from '../../application/ports/image-storage.js';

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
  constructor(private readonly images?: ImageStorage) {}

  async render(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data);
    return renderTemplatePng(svg, template, data, this.images);
  }

  async renderPreview(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data, { watermark: true });
    const rendered = await renderTemplatePng(svg, template, data, this.images);
    return sharp(rendered)
      .resize({ width: 540, height: 10_000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  }
}

async function renderTemplatePng(
  svg: string,
  template: Template,
  data: JsonObject,
  images?: ImageStorage,
): Promise<Buffer> {
  const card = resolveTemplateCard(template.definition);
  const renderer = sharp(Buffer.from(svg));
  if (!card) return renderer.png().toBuffer();

  const [column, row] = STATUS_ICON_POSITION[card.illustration];
  const icon = await sharp(STATUS_SPRITE_PATH)
    .extract({ left: column * 384, top: row * 256, width: 384, height: 256 })
    .png()
    .toBuffer();

  const composites: OverlayOptions[] = [{ input: icon, left: 348, top: 132 }];
  const logoOverlay = card.brand?.logoFieldId && images
    ? await createImageOverlay(images, data[card.brand.logoFieldId], { left: 72, top: 52, width: 76, height: 76, fit: 'inside' })
    : undefined;
  if (logoOverlay) composites.push(logoOverlay);

  const visibleDetails = resolveVisibleDetails(template, data, card);
  if (images) {
    const detailStartY = getDetailsStartY(template, data, card);
    for (const [index, detail] of visibleDetails.entries()) {
      if (!detail.imageFieldId) continue;
      const overlay = await createImageOverlay(images, data[detail.imageFieldId], {
        left: 148,
        top: detailStartY + index * 104 + 15,
        width: 56,
        height: 56,
        fit: 'cover',
      });
      if (overlay) composites.push(overlay);
    }
  }

  return renderer
    .composite(composites)
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
  const visibleDetails = resolveVisibleDetails(template, data, card);
  const actions = card.actions ?? (card.action ? [card.action] : []);
  const headingLines = wrapText(heading, 22);
  const messageLines = message ? wrapText(message, 34) : [];
  const textX = visuals.layout === 'editorial' ? 150 : 540;
  const textAnchor = visuals.layout === 'editorial' ? 'start' : 'middle';
  const hasDetails = Boolean(visibleDetails.length || actions.length);
  const artBottom = hasDetails ? 610 : 806;
  const headingY = hasDetails ? 704 : 940;
  const headingMarkup = headingLines
    .map((line, index) => `<text x="${textX}" y="${headingY + index * 68}" text-anchor="${textAnchor}" class="card-title">${escapeXml(line)}</text>`)
    .join('');
  const messageStart = headingY + headingLines.length * 68 + 14;
  const messageMarkup = messageLines
    .map((line, index) => `<text x="${textX}" y="${messageStart + 38 + index * 44}" text-anchor="${textAnchor}" class="card-message">${escapeXml(line)}</text>`)
    .join('');
  let detailsY = messageStart + Math.max(1, messageLines.length) * 44 + 38;
  const detailsMarkup = visibleDetails.map((detail) => {
    const value = interpolateCardText(detail.value, fields, data, detail.format, false);
    const rowY = detailsY;
    detailsY += 104;
    return `<rect x="126" y="${rowY}" width="828" height="86" rx="22" fill="#eff7ff"/><rect x="148" y="${rowY + 15}" width="56" height="56" rx="16" fill="#dbeeff"/>${detailIconSvg(detail.icon, rowY + 15)}<text x="228" y="${rowY + 38}" class="detail-label">${escapeXml(detail.label)}</text><text x="228" y="${rowY + 67}" class="detail-value">${escapeXml(value)}</text>`;
  }).join('');
  const actionMarkup = actions.map((action, index) => {
    const top = detailsY + 2 + index * 78;
    return `<rect x="126" y="${top}" width="828" height="68" rx="20" fill="${visuals.accent}"/><text x="540" y="${top + 44}" text-anchor="middle" class="action-label">${escapeXml(action.label)}</text>`;
  }).join('');
  const heartY = messageLines.length > 0 ? messageStart + messageLines.length * 44 + 58 : messageStart + 42;
  const footerMarkup = card.footer === 'heart' && !hasDetails
    ? `<text x="${visuals.layout === 'editorial' ? 520 : 540}" y="${heartY}" text-anchor="middle" class="card-heart">♡</text>`
    : '';
  const watermarkY = hasDetails ? 620 : 675;
  const watermark = options.watermark
    ? `<text x="540" y="${watermarkY}" transform="rotate(-18 540 ${watermarkY})" text-anchor="middle" class="watermark">PRÉVIA · CADERNÔ</text>`
    : '';
  const frame = renderFrame(visuals, 1_350);
  const font = fontFamily(visuals.headingFont);
  const bodyFont = fontFamily(visuals.bodyFont);
  const brandName = card.brand
    ? interpolateCardText(`{{${card.brand.businessNameFieldId}}}`, fields, data)
    : '';
  const clippedBrandName = Array.from(brandName).slice(0, 20).join('');
  const brandMarkup = card.brand
    ? `<text x="158" y="103" class="brand-name" textLength="176" lengthAdjust="spacingAndGlyphs">${escapeXml(clippedBrandName)}</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><clipPath id="card-clip"><rect x="36" y="36" width="1008" height="1278" rx="72"/></clipPath></defs><rect width="100%" height="100%" fill="${visuals.background}"/><g clip-path="url(#card-clip)"><rect x="36" y="36" width="1008" height="${artBottom - 36}" fill="${visuals.background}"/><rect x="36" y="${artBottom}" width="1008" height="${1314 - artBottom}" fill="${visuals.surface}"/></g>${brandMarkup}${headingMarkup}${messageMarkup}${detailsMarkup}${actionMarkup}${footerMarkup}${watermark}${frame}<style>.brand-name{font:700 26px ${font};fill:${visuals.heading}}.card-title{font:800 62px ${font};fill:${visuals.heading}}.card-message{font:400 38px ${bodyFont};fill:${visuals.text}}.detail-label{font:400 22px ${bodyFont};fill:${visuals.muted}}.detail-value{font:700 27px ${font};fill:${visuals.heading}}.action-label{font:700 26px ${font};fill:#fff}.card-heart{font:700 68px Arial,sans-serif;fill:${visuals.accent}}.watermark{font:700 82px ${font};fill:${visuals.accent};fill-opacity:.5;stroke:${visuals.background};stroke-opacity:.4;stroke-width:2}</style></svg>`;
  if (svg.length > MAX_SVG_LENGTH) throw new ExportContentTooLargeError();
  return svg;
}

async function createImageOverlay(
  images: ImageStorage,
  value: unknown,
  options: { left: number; top: number; width: number; height: number; fit: 'cover' | 'inside' },
): Promise<OverlayOptions | undefined> {
  if (typeof value !== 'string' || !isImageAssetId(value)) return undefined;
  try {
    const image = await images.get(value);
    if (!image || image.bytes.length > 131_072 || !hasValidSignature(image.bytes, image.contentType)) return undefined;
    const input = await sharp(image.bytes, { limitInputPixels: 16_000_000 })
      .rotate()
      .resize({ width: options.width, height: options.height, fit: options.fit, withoutEnlargement: options.fit === 'inside' })
      .png()
      .toBuffer();
    return { input, left: options.left, top: options.top };
  } catch {
    return undefined;
  }
}

function isImageAssetId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasValidSignature(bytes: Buffer, contentType: string): boolean {
  const isPng = contentType === 'image/png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = contentType === 'image/jpeg' &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = contentType === 'image/webp' &&
    bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return isPng || isJpeg || isWebp;
}

function getDetailsStartY(
  template: Template,
  data: JsonObject,
  card: NonNullable<ReturnType<typeof resolveTemplateCard>>,
): number {
  const fields = Array.isArray(template.definition.fields) ? template.definition.fields : [];
  const headingLines = wrapText(interpolateCardText(card.heading, fields, data), 22);
  const message = card.message ? interpolateCardText(card.message, fields, data) : '';
  const messageLines = message ? wrapText(message, 34) : [];
  const hasDetails = Boolean(resolveVisibleDetails(template, data, card).length || card.actions?.length || card.action);
  const headingY = hasDetails ? 704 : 940;
  const messageStart = headingY + headingLines.length * 68 + 14;
  return messageStart + Math.max(1, messageLines.length) * 44 + 38;
}

function resolveVisibleDetails(
  template: Template,
  data: JsonObject,
  card: NonNullable<ReturnType<typeof resolveTemplateCard>>,
) {
  const fields = Array.isArray(template.definition.fields) ? template.definition.fields : [];
  return (card.details ?? []).filter((detail) =>
    interpolateCardText(detail.value, fields, data, detail.format, false).trim().length > 0,
  );
}

function interpolateCardText(
  template: string,
  fields: unknown[],
  data: JsonObject,
  format?: string,
  usePlaceholders = true,
): string {
  const value = template.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g, (_match, fieldId: string) => {
    const value = data[fieldId];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    const field = fields.find((candidate) =>
      typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate) &&
      'id' in candidate && candidate.id === fieldId,
    );
    if (usePlaceholders && typeof field === 'object' && field !== null && !Array.isArray(field) && 'placeholder' in field && typeof field.placeholder === 'string') {
      return field.placeholder;
    }
    return '';
  });
  if (format === 'currency' && value.trim().length > 0) {
    const amount = Number(value.replace(',', '.'));
    if (Number.isFinite(amount)) {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
    }
  }
  if (format === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T12:00:00.000Z`);
    if (Number.isFinite(date.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
    }
  }
  return value;
}

function detailIconSvg(icon: string | undefined, top: number): string {
  if (icon === 'credit-card') {
    return `<rect x="160" y="${top + 18}" width="32" height="24" rx="5" fill="none" stroke="#1677eb" stroke-width="4"/><path d="M162 ${top + 27}h28M167 ${top + 35}h8" stroke="#1677eb" stroke-width="3" stroke-linecap="round"/>`;
  }
  if (icon === 'calendar') {
    return `<rect x="160" y="${top + 20}" width="32" height="28" rx="5" fill="none" stroke="#1677eb" stroke-width="4"/><path d="M160 ${top + 28}h32M168 ${top + 16}v8m16-8v8" stroke="#1677eb" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (icon === 'check') {
    return `<circle cx="176" cy="${top + 43}" r="15" fill="none" stroke="#1677eb" stroke-width="4"/><path d="m168 ${top + 43} 6 6 12-13" fill="none" stroke="#1677eb" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (icon === 'link') {
    return `<path d="m171 ${top + 42} 10-10m-15 17 5-5m10-10 5-5a8 8 0 0 1 11 11l-5 5" fill="none" stroke="#1677eb" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (icon === 'qrcode') {
    return `<path d="M160 ${top + 20}h12v12h-12zM180 ${top + 20}h12v12h-12zM160 ${top + 40}h12v12h-12zM180 ${top + 40}v5m8-5v12" fill="none" stroke="#1677eb" stroke-width="4"/>`;
  }
  return `<path d="M160 ${top + 28}h32l-3 22h-26zM160 ${top + 28}l8-9h16l8 9m-24 0v8h16v-8" fill="none" stroke="#1677eb" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
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
