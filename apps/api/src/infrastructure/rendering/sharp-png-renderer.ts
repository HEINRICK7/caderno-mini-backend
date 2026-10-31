import sharp from 'sharp';

import type { PngRenderer } from '../../application/ports/png-renderer.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import type { Template } from '../../domain/templates/template.js';
import { resolveTemplateCard } from '../../domain/templates/template-card.js';
import { resolveTemplateVisuals, type TemplateVisuals } from '../../domain/templates/template-visuals.js';
import { ExportContentTooLargeError } from '../../application/errors.js';

const WIDTH = 1_080;
const MAX_FIELDS = 40;
const MAX_SVG_LENGTH = 140_000;

export class SharpPngRenderer implements PngRenderer {
  async render(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data);
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  async renderPreview(template: Template, data: JsonObject): Promise<Buffer> {
    const svg = renderSvg(template, data, { watermark: true });
    return sharp(Buffer.from(svg))
      .resize({ width: 540, height: 10_000, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  }
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
  const illustration = renderCardIllustration(card.illustration);
  const watermarkY = 675;
  const watermark = options.watermark
    ? `<text x="540" y="${watermarkY}" transform="rotate(-18 540 ${watermarkY})" text-anchor="middle" class="watermark">PRÉVIA · CADERNÔ</text>`
    : '';
  const frame = renderFrame(visuals, 1_350);
  const font = fontFamily(visuals.headingFont);
  const bodyFont = fontFamily(visuals.bodyFont);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><clipPath id="card-clip"><rect x="36" y="36" width="1008" height="1278" rx="72"/></clipPath></defs><rect width="100%" height="100%" fill="${visuals.background}"/><g clip-path="url(#card-clip)"><rect x="36" y="36" width="1008" height="770" fill="${visuals.background}"/><rect x="36" y="806" width="1008" height="508" fill="${visuals.surface}"/>${illustration}</g>${headingMarkup}${messageMarkup}<text x="${visuals.layout === 'editorial' ? 520 : 540}" y="${heartY}" text-anchor="middle" class="card-heart">♡</text>${watermark}${frame}<style>.card-title{font:800 62px ${font};fill:${visuals.heading}}.card-message{font:400 38px ${bodyFont};fill:${visuals.text}}.card-heart{font:700 68px Arial,sans-serif;fill:${visuals.accent}}.watermark{font:700 82px ${font};fill:${visuals.accent};fill-opacity:.5;stroke:${visuals.background};stroke-opacity:.4;stroke-width:2}</style></svg>`;
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

function renderCardIllustration(illustration: 'wave' | 'shopping-bag-heart' | 'gift'): string {
  if (illustration === 'wave') {
    return `<g transform="translate(420 145) scale(1.55)"><path d="M45 138c-14-8-19-22-11-34l13-19 7-35c2-10 17-9 18 2l1 20 6-45c2-11 18-9 18 2l-1 43 7-48c2-11 18-8 18 3l-4 49 9-37c3-10 18-5 15 6l-9 53c-3 19-12 34-25 45l-7 9-49-14-6 0Z" fill="#ffad3d" stroke="#e58527" stroke-width="4" stroke-linejoin="round"/><path d="m176 54 6-12m5 26 12-5m-26 56 11 7" fill="none" stroke="#ffbf5c" stroke-linecap="round" stroke-width="8"/></g>`;
  }
  if (illustration === 'shopping-bag-heart') {
    return `<g transform="translate(420 135) scale(1.55)"><path d="m54 68 8 87c1 9 8 16 17 16h82c9 0 16-7 17-16l8-87H54Z" fill="#1676ef" stroke="#1764d8" stroke-width="5" stroke-linejoin="round"/><path d="M91 74V55c0-18 13-32 29-32s29 14 29 32v19" fill="none" stroke="#1764d8" stroke-width="13" stroke-linecap="round"/><path d="M120 136c-4-4-24-18-24-31 0-13 16-18 24-6 8-12 24-7 24 6 0 13-20 27-24 31Z" fill="#fff"/><path d="m38 79 4-10m-8 24-9 1m172-22 7-8m-1 25 10 3" fill="none" stroke="#69adff" stroke-linecap="round" stroke-width="7"/></g>`;
  }
  return `<g transform="translate(420 135) scale(1.55)"><path d="m54 83 66-40 66 40-66 39-66-39Z" fill="#cf91ff" stroke="#8e43df" stroke-width="5" stroke-linejoin="round"/><path d="M70 91v54l50 31 50-31V91l-50 31-50-31Z" fill="#a856e8" stroke="#8e43df" stroke-width="5" stroke-linejoin="round"/><path d="m108 113 24-14 5 76-24-3-5-59Z" fill="#f3cbff"/><path d="M116 48c-22-4-31-28-12-32 16-3 21 17 16 31-2-21 10-39 26-30 15 9 1 28-30 31Z" fill="#a857ed" stroke="#8536d1" stroke-width="4" stroke-linejoin="round"/><path d="m31 67-6-10m187 43 11-4m-25-62 7-9" fill="none" stroke="#bf7bf4" stroke-linecap="round" stroke-width="8"/></g>`;
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
