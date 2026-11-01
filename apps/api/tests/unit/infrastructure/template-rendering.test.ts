import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpPngRenderer } from '../../../src/infrastructure/rendering/sharp-png-renderer.js';
import type { Template } from '../../../src/domain/templates/template.js';
import type { ImageStorage } from '../../../src/application/ports/image-storage.js';

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

  it('renders configured detail rows, currency values, and call-to-action in the exported card', async () => {
    const template: Template = {
      id: 'purchase-thanks',
      version: 1,
      name: 'Agradecimento pela compra',
      description: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      definition: {
        fields: [
          { id: 'recipientName', type: 'text', placeholder: 'Maria' },
          { id: 'productName', type: 'text', placeholder: 'Conjunto de mesa' },
          { id: 'purchaseAmount', type: 'number', placeholder: '350,00' },
        ],
        visual: {
          layout: 'centered',
          background: '#E5F0FF',
          surface: '#FFFFFF',
          accent: '#2563EB',
          heading: '#10264F',
          text: '#385176',
          muted: '#687895',
          headingFont: 'rounded',
          bodyFont: 'sans',
          frame: 'none',
        },
        card: {
          illustration: 'shopping-bag-heart',
          heading: 'Obrigado, {{recipientName}}!',
          message: 'Sua compra foi registrada com sucesso.',
          details: [
            { label: 'Produto', value: '{{productName}}', icon: 'package' },
            { label: 'Valor', value: '{{purchaseAmount}}', icon: 'credit-card', format: 'currency' },
          ],
          action: { label: 'Ver detalhes da compra' },
          footer: 'none',
        },
      },
    };

    const png = await new SharpPngRenderer().render(template, {
      recipientName: 'Maria',
      productName: 'Conjunto de mesa',
      purchaseAmount: 350,
    });
    const metadata = await sharp(png).metadata();

    expect(metadata).toMatchObject({ width: 1080, height: 1350, format: 'png' });
  });

  it('renders the optional company logo and product image from server-side asset IDs', async () => {
    const logo = await sharp({
      create: { width: 24, height: 24, channels: 4, background: '#ff0000' },
    }).png().toBuffer();
    const productImage = await sharp({
      create: { width: 24, height: 24, channels: 4, background: '#00ff00' },
    }).png().toBuffer();
    const logoId = '7b7d828b-f189-496a-b59b-9fae6a9b8531';
    const productImageId = 'cbf2c3db-a64c-47d7-98dc-f9a9257588a4';
    const images: ImageStorage = {
      put: async () => undefined,
      get: async (id) => id === logoId
        ? { bytes: logo, contentType: 'image/png' }
        : id === productImageId
          ? { bytes: productImage, contentType: 'image/png' }
          : undefined,
    };
    const template: Template = {
      id: 'purchase-thanks',
      version: 1,
      name: 'Agradecimento pela compra',
      description: null,
      isActive: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      definition: {
        fields: [
          { id: 'businessName', type: 'text', placeholder: 'Loja Exemplo' },
          { id: 'businessLogo', type: 'image', maxBytes: 131072 },
          { id: 'productImage', type: 'image', maxBytes: 131072 },
        ],
        card: {
          illustration: 'shopping-bag-heart',
          heading: 'Obrigado!',
          brand: { businessNameFieldId: 'businessName', logoFieldId: 'businessLogo' },
          details: [{ label: 'Produto', value: 'Conjunto de mesa', imageFieldId: 'productImage', icon: 'package' }],
          footer: 'none',
        },
      },
    };

    const png = await new SharpPngRenderer(images).render(template, {
      businessName: 'Loja Exemplo',
      businessLogo: logoId,
      productImage: productImageId,
    });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixelOffset = (60 * info.width + 80) * info.channels;
    const productOffset = (895 * info.width + 160) * info.channels;

    expect(Array.from(data.subarray(pixelOffset, pixelOffset + 3))).toEqual([255, 0, 0]);
    expect(Array.from(data.subarray(productOffset, productOffset + 3))).toEqual([0, 255, 0]);
  });
});
