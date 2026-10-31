import sharp from 'sharp';

import type { PngRenderer } from '../../application/ports/png-renderer.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import type { Template } from '../../domain/templates/template.js';
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
  const content = entries.map(([key, value]) => {
    const label = escapeXml(labels.get(key) ?? key);
    const lines = wrapText(asText(value), 31);
    if (lines.length > 300) {
      throw new ExportContentTooLargeError();
    }
    const height = 68 + lines.length * 54;
    const labelY = y + 48;
    const valueLines = lines
      .map((line, index) => `<text x="104" y="${labelY + 56 + index * 50}" class="value">${escapeXml(line)}</text>`)
      .join('');
    const result = `<rect x="64" y="${y}" width="952" height="${height}" rx="24" fill="#fff"/><text x="104" y="${labelY}" class="label">${label}</text>${valueLines}`;
    y += height + 24;
    return result;
  });

  const height = Math.max(1_350, y + 90);
  const watermarkY = Math.floor(height / 2);
  const watermark = options.watermark
    ? `<text x="${WIDTH / 2}" y="${watermarkY}" transform="rotate(-24 ${WIDTH / 2} ${watermarkY})" text-anchor="middle" class="watermark">PRÉVIA · CADERNÔ</text>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}"><rect width="100%" height="100%" fill="#f7f1e8"/><text x="64" y="112" class="brand">Cadernô</text><text x="64" y="172" class="title">${escapeXml(template.name.slice(0, 120))}</text>${content.join('')}${watermark}<style>.brand{font:600 28px sans-serif;fill:#8b6245}.title{font:700 42px sans-serif;fill:#30271f}.label{font:600 26px sans-serif;fill:#705a49}.value{font:400 34px sans-serif;fill:#2f2a27}.watermark{font:700 82px sans-serif;fill:#8b6245;fill-opacity:.36;stroke:#f7f1e8;stroke-opacity:.32;stroke-width:2}</style></svg>`;
  if (svg.length > MAX_SVG_LENGTH || height > 20_000) {
    throw new ExportContentTooLargeError();
  }
  return svg;
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
