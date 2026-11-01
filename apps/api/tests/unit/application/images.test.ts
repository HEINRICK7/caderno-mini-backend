import { describe, expect, it, vi } from 'vitest';

import { ImageStorageUnavailableError, InvalidImageUploadError } from '../../../src/application/errors.js';
import type { ImageStorage, StoredImage } from '../../../src/application/ports/image-storage.js';
import { getImage, uploadImage } from '../../../src/application/use-cases/images.js';

const validPng = 'data:image/png;base64,iVBORw0KGgo=';
const assetId = '7b7d828b-f189-496a-b59b-9fae6a9b8531';

function storage(overrides: Partial<ImageStorage> = {}) {
  const images: ImageStorage = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => undefined),
    ...overrides,
  };
  return images;
}

describe('image use cases', () => {
  it('validates an image and stores bytes under an opaque generated ID', async () => {
    const images = storage();
    const result = await uploadImage({ dataUrl: validPng }, { images, generateId: () => assetId });

    expect(result).toEqual({ id: assetId });
    expect(images.put).toHaveBeenCalledWith({
      id: assetId,
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      contentType: 'image/png',
    });
  });

  it('rejects unsupported, malformed or mismatched images and images over 128 KiB', async () => {
    const tooLarge = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      Buffer.alloc(128 * 1024),
    ]);
    for (const dataUrl of [
      'https://example.com/image.png',
      'data:image/jpeg;base64,iVBORw0KGgo=',
      'data:image/png;base64,iVBORw0KGgo!',
      `data:image/png;base64,${tooLarge.toString('base64')}`,
    ]) {
      await expect(uploadImage({ dataUrl }, { images: storage(), generateId: () => assetId }))
        .rejects.toBeInstanceOf(InvalidImageUploadError);
    }
  });

  it('reports MinIO write and read failures as temporary storage errors', async () => {
    const unavailable = storage({
      put: async () => { throw new Error('sensitive storage details'); },
      get: async () => { throw new Error('sensitive storage details'); },
    });

    await expect(uploadImage({ dataUrl: validPng }, { images: unavailable, generateId: () => assetId }))
      .rejects.toBeInstanceOf(ImageStorageUnavailableError);
    await expect(getImage({ id: assetId }, { images: unavailable }))
      .rejects.toBeInstanceOf(ImageStorageUnavailableError);
  });

  it('returns the stored image by asset ID', async () => {
    const image: StoredImage = {
      bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      contentType: 'image/png',
    };
    const get = vi.fn(async () => image);
    const images = storage({ get });

    await expect(getImage({ id: assetId }, { images })).resolves.toEqual(image);
    expect(get).toHaveBeenCalledWith(assetId);
  });
});
