import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpPngRenderer } from '../../../src/infrastructure/rendering/sharp-png-renderer.js';
import type { Template } from '../../../src/domain/templates/template.js';

describe('SharpPngRenderer', () => {
  it('renders the background color selected by the backend template definition', async () => {
    const template: Template = {
      id: 'style-test',
      version: 1,
      name: 'Teste visual',
      description: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      definition: {
        fields: [{ id: 'message', type: 'text', label: 'Mensagem' }],
        visual: {
          layout: 'card',
          background: '#123456',
          surface: '#EEEEEE',
          accent: '#884422',
          heading: '#112233',
          text: '#221100',
          muted: '#665544',
          headingFont: 'serif',
          bodyFont: 'sans',
          frame: 'none',
        },
      },
    };

    const png = await new SharpPngRenderer().render(template, { message: 'Olá' });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const topLeftPixel = Array.from(data.subarray(0, info.channels));

    expect(topLeftPixel).toEqual([0x12, 0x34, 0x56]);
  });
});
