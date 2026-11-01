import type { ImageStorage, StoredImageContentType } from '../ports/image-storage.js';
import { ImageStorageUnavailableError, InvalidImageUploadError } from '../errors.js';
import { MAX_IMAGE_BYTES } from '../../domain/images/image-limits.js';

const dataUriPattern = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export async function uploadImage(
  input: { dataUrl: string },
  dependencies: { images: ImageStorage; generateId: () => string },
): Promise<{ id: string }> {
  const image = decodeImageDataUrl(input.dataUrl);
  const id = dependencies.generateId();
  try {
    await dependencies.images.put({ id, ...image });
  } catch {
    throw new ImageStorageUnavailableError();
  }
  return { id };
}

export async function getImage(
  input: { id: string },
  dependencies: { images: ImageStorage },
) {
  try {
    return await dependencies.images.get(input.id);
  } catch {
    throw new ImageStorageUnavailableError();
  }
}

function decodeImageDataUrl(dataUrl: string): {
  bytes: Buffer;
  contentType: StoredImageContentType;
} {
  const match = dataUriPattern.exec(dataUrl);
  if (!match || !match[1] || !match[2] || match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
    throw new InvalidImageUploadError();
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    throw new InvalidImageUploadError();
  }

  const contentTypes: Record<string, StoredImageContentType> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  const contentType = contentTypes[match[1]];
  const validSignature =
    (contentType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (contentType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (contentType === 'image/webp' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP');

  if (!contentType || !validSignature) throw new InvalidImageUploadError();
  return { bytes, contentType };
}
