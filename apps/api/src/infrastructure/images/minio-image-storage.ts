import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ImageStorage, StoredImage, StoredImageContentType } from '../../application/ports/image-storage.js';

const MAX_IMAGE_BYTES = 128 * 1024;
const allowedContentTypes = new Set<StoredImageContentType>(['image/png', 'image/jpeg', 'image/webp']);

export type MinioImageStorageConfig = {
  endpoint: string;
  port: number;
  useSSL: boolean;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
};

export class MinioImageStorage implements ImageStorage {
  private readonly client: S3Client;

  constructor(private readonly config: MinioImageStorageConfig, client?: S3Client) {
    this.client = client ?? new S3Client({
      endpoint: `${config.useSSL ? 'https' : 'http'}://${config.endpoint}:${config.port}`,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: true,
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 10_000 },
    });
  }

  async put(input: { id: string; bytes: Buffer; contentType: StoredImageContentType }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.id,
      Body: input.bytes,
      ContentLength: input.bytes.length,
      ContentType: input.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  }

  async get(id: string): Promise<StoredImage | undefined> {
    let stat;
    try {
      stat = await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: id }));
    } catch (error) {
      if (isMissingObject(error)) return undefined;
      throw error;
    }
    const contentType = stat.ContentType;
    if (
      typeof stat.ContentLength !== 'number' || stat.ContentLength < 1 || stat.ContentLength > MAX_IMAGE_BYTES ||
      typeof contentType !== 'string' || !allowedContentTypes.has(contentType as StoredImageContentType)
    ) {
      return undefined;
    }

    const object = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: id }));
    if (!object.Body) return undefined;
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length < 1 || bytes.length > MAX_IMAGE_BYTES) return undefined;
    return {
      bytes,
      contentType: contentType as StoredImageContentType,
    };
  }
}

function isMissingObject(error: unknown): boolean {
  return errorName(error) === 'NoSuchKey' || errorName(error) === 'NoSuchObject' || errorName(error) === 'NotFound' ||
    (typeof error === 'object' && error !== null && '$metadata' in error &&
      typeof error.$metadata === 'object' && error.$metadata !== null &&
      'httpStatusCode' in error.$metadata && error.$metadata.httpStatusCode === 404);
}

function errorName(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined;
}
