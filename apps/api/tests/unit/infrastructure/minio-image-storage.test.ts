import { describe, expect, it, vi } from 'vitest';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

import { MinioImageStorage } from '../../../src/infrastructure/images/minio-image-storage.js';

const config = {
  endpoint: 'minio.example.test',
  port: 9000,
  useSSL: true,
  region: 'us-east-1',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  bucket: 'caderno-assets',
};
const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fakeClient(send: ReturnType<typeof vi.fn>): S3Client {
  return { send } as unknown as S3Client;
}

describe('MinioImageStorage', () => {
  it('stores immutable image objects with their content type', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = new MinioImageStorage(config, fakeClient(send));

    await storage.put({ id: 'asset-uuid', bytes: imageBytes, contentType: 'image/png' });

    const command = send.mock.calls[0]?.[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'caderno-assets',
      Key: 'asset-uuid',
      Body: imageBytes,
      ContentLength: imageBytes.length,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('reads bounded images by object ID and ignores unsupported metadata', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ ContentLength: imageBytes.length, ContentType: 'image/png' })
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => imageBytes } });
    const storage = new MinioImageStorage(config, fakeClient(send));

    await expect(storage.get('asset-uuid')).resolves.toEqual({ bytes: imageBytes, contentType: 'image/png' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: 'caderno-assets',
      Key: 'asset-uuid',
    });

    send.mockReset().mockResolvedValueOnce({ ContentLength: imageBytes.length, ContentType: 'text/html' });
    await expect(storage.get('asset-uuid')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns missing for absent objects and over-limit objects', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'NoSuchKey' });
    const send = vi.fn().mockRejectedValueOnce(missing);
    const storage = new MinioImageStorage(config, fakeClient(send));

    await expect(storage.get('absent')).resolves.toBeUndefined();

    send.mockReset().mockResolvedValueOnce({ ContentLength: 128 * 1024 + 1, ContentType: 'image/png' });
    await expect(storage.get('oversized')).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
